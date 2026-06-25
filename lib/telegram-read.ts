import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM READ + ANSWER — the inbound half of the Telegram seam. The build bot
// only BROADCASTS (telegram-send); this LISTENS via getUpdates and, when someone
// asks the bot a question, replies with a memory-grounded answer (lib/agent-answer,
// hard-railed against hallucination). With Bot privacy ON (default), getUpdates
// only returns messages that @mention the bot or reply to it — exactly "questions
// addressed to me" — so it never scrapes the whole group.
//
// Cursor: the max stored update_id is the getUpdates `offset` (offset also ACKs
// prior updates off Telegram's queue). Idempotent via unique(project_key,update_id).
// Replies are PLAIN text (no MarkdownV2) so an LLM answer never breaks on escaping.
// getUpdates conflicts with a webhook (409) — handled as a clean no-op. Gated by
// AGENT_COMMUNITY_ANSWER; bounded + failure-safe.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "./supabase";
import type { Project } from "./types";

const API = "https://api.telegram.org";

interface TgUpdate {
  update_id: number;
  message?: {
    message_id?: number;
    chat?: { id?: number | string };
    from?: { username?: string; first_name?: string };
    text?: string;
  };
}

async function sendReply(
  token: string,
  chatId: string,
  text: string,
  replyToMessageId?: number
): Promise<boolean> {
  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 3500),
        disable_web_page_preview: true,
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Poll Telegram for messages addressed to the bot and answer the questions,
 * grounded. Returns the number of replies sent. No-op (0) when disarmed,
 * unconfigured, or nothing new. Never throws.
 */
export async function pollAndAnswerTelegram(p: Project, max = 3): Promise<number> {
  const { communityAnswerArmed, looksLikeQuestion, answerCommunityQuestion } = await import("./agent-answer");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!communityAnswerArmed() || !token || !supabaseAdmin) return 0;
  try {
    const { data: last } = await supabaseAdmin
      .from("telegram_messages")
      .select("update_id")
      .eq("project_key", p.key)
      .order("update_id", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastId = (last as { update_id?: number } | null)?.update_id;
    const params = new URLSearchParams({ timeout: "0", allowed_updates: '["message"]' });
    if (lastId) params.set("offset", String(Number(lastId) + 1));

    const res = await fetch(`${API}/bot${token}/getUpdates?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return 0; // 409 = a webhook is set; treat as no-op
    const json = (await res.json()) as { ok?: boolean; result?: TgUpdate[] };
    const updates = json.result ?? [];
    if (!updates.length) return 0;

    let sent = 0;
    let answeredCount = 0;
    for (const u of updates) {
      const m = u.message;
      if (!m || typeof u.update_id !== "number") continue;
      const text = (m.text ?? "").toString();
      const chatId = String(m.chat?.id ?? "");
      const author = m.from?.username || m.from?.first_name || "someone";

      // Persist (advances the cursor + idempotent). Bot's own posts have no `from`
      // username matching a person, but getUpdates never returns the bot's own
      // messages anyway, so no self-answer risk.
      await supabaseAdmin.from("telegram_messages").upsert(
        {
          project_key: p.key,
          update_id: u.update_id,
          chat_id: chatId,
          message_id: String(m.message_id ?? ""),
          author_name: author,
          content: text.slice(0, 2000),
          answered: false,
        },
        { onConflict: "project_key,update_id", ignoreDuplicates: true }
      );

      if (answeredCount < max && text && chatId && looksLikeQuestion(text)) {
        answeredCount++;
        const { text: reply } = await answerCommunityQuestion(p, text, "telegram");
        if (reply) {
          const ok = await sendReply(token, chatId, reply, m.message_id);
          if (ok) sent++;
        }
        await supabaseAdmin
          .from("telegram_messages")
          .update({ answered: true })
          .eq("project_key", p.key)
          .eq("update_id", u.update_id);
      }
    }
    return sent;
  } catch {
    return 0;
  }
}
