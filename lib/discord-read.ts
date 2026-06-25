import "server-only";

import { supabaseAdmin } from "./supabase";
import { isDiscordBotConfigured, findChannelId, fetchMessagesAfter, postToChannel } from "./discord-bot";
import type { Project } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// DISCORD READ → MEMORY — the INBOUND half of the Discord seam. Where
// discord-send broadcasts the build-log, this LISTENS: each tick it polls the
// community channels (#general, #ideas) for new messages and persists them to
// public.discord_messages, then surfaces a compact, UNTRUSTED digest into the
// agent's decision context (the same way audience replies would feed memory).
//
// Cursor model (no gateway, fits cron): the max stored message_id per channel is
// the "after" cursor for the next fetch — Discord snowflake ids sort by time, so
// "after the last id we stored" == "everything new since last tick". Bot's own
// messages and other bots are skipped so the agent never ingests its own voice.
//
// Failure-safe + bounded by construction: unconfigured ⇒ no-op; any error is
// swallowed; capped per channel so a flood can't blow up a tick or the prompt.
// ─────────────────────────────────────────────────────────────────────────────

/** Community channels polled for memory. Resolved to ids by name per guild. */
export const COMMUNITY_CHANNELS = ["general", "ideas"] as const;

export interface CommunityMessage {
  author: string;
  channel: string;
  content: string;
}

/** The bot's own user id == the application id; used to skip its own posts. */
function selfId(): string | undefined {
  // The application id is the leading segment of the bot token (base64 of the id).
  const tok = process.env.DISCORD_BOT_TOKEN;
  if (!tok) return undefined;
  try {
    return Buffer.from(tok.split(".")[0], "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

/**
 * Poll the community channels for new messages and persist them. Returns the
 * number of new rows stored. No-op (0) when the bot or DB isn't configured.
 * Idempotent: the unique (project_key, message_id) constraint + ignoreDuplicates
 * means a re-run never double-stores.
 */
export async function pollDiscordCommunity(
  projectKey: string,
  channels: readonly string[] = COMMUNITY_CHANNELS
): Promise<number> {
  if (!isDiscordBotConfigured() || !supabaseAdmin) return 0;
  const me = selfId();
  let stored = 0;
  for (const name of channels) {
    try {
      const channelId = await findChannelId(name);
      if (!channelId) continue;

      // Cursor: the newest message_id we've already stored for this channel.
      const { data: last } = await supabaseAdmin
        .from("discord_messages")
        .select("message_id")
        .eq("project_key", projectKey)
        .eq("channel_id", channelId)
        .order("message_id", { ascending: false })
        .limit(1)
        .maybeSingle();
      const afterId = (last?.message_id as string | undefined) ?? undefined;

      const msgs = await fetchMessagesAfter(channelId, afterId, 50);
      const rows = msgs
        .filter((m) => !m.author?.bot && m.author?.id !== me && (m.content ?? "").trim())
        .map((m) => ({
          project_key: projectKey,
          channel_id: channelId,
          channel_name: name,
          message_id: m.id,
          author_id: m.author.id,
          author_name: m.author.username,
          content: m.content.slice(0, 2000),
          created_at: m.timestamp,
        }));
      if (!rows.length) continue;

      const { error } = await supabaseAdmin
        .from("discord_messages")
        .upsert(rows, { onConflict: "project_key,message_id", ignoreDuplicates: true });
      if (!error) stored += rows.length;
    } catch {
      /* one bad channel never aborts the rest */
    }
  }
  return stored;
}

/**
 * The most recent community messages for a project (newest first), for injection
 * into the decision context. Returns [] on any failure / unconfigured DB.
 */
export async function recentCommunityMessages(
  projectKey: string,
  limit = 8
): Promise<CommunityMessage[]> {
  if (!supabaseAdmin) return [];
  try {
    const { data } = await supabaseAdmin
      .from("discord_messages")
      .select("author_name, channel_name, content")
      .eq("project_key", projectKey)
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data as { author_name?: string; channel_name?: string; content?: string }[] | null) ?? [])
      .map((r) => ({
        author: r.author_name ?? "someone",
        channel: r.channel_name ?? "general",
        content: (r.content ?? "").trim(),
      }))
      .filter((m) => m.content);
  } catch {
    return [];
  }
}

/** Compact, prompt-ready lines for a community digest (or a quiet placeholder). */
export function formatCommunityForPrompt(msgs: CommunityMessage[]): string {
  if (!msgs.length) return "(no recent community messages)";
  return msgs
    .map((m) => `- ${m.author} in #${m.channel}: ${m.content.replace(/\s+/g, " ").slice(0, 240)}`)
    .join("\n");
}

/**
 * Answer recent UNANSWERED community questions in Discord — grounded in the
 * agent's real knowledge (no hallucination, see lib/agent-answer). Reads the
 * ingested discord_messages, picks question-like ones, posts a reply in the same
 * channel, and marks them answered (so they're never answered twice — including
 * when the model judges it shouldn't reply, SKIP). Gated by AGENT_COMMUNITY_ANSWER;
 * bounded + failure-safe. Returns the number of replies sent.
 */
export async function answerDiscordQuestions(p: Project, max = 3): Promise<number> {
  const { communityAnswerArmed, looksLikeQuestion, answerCommunityQuestion } = await import("./agent-answer");
  if (!communityAnswerArmed() || !isDiscordBotConfigured() || !supabaseAdmin) return 0;
  try {
    const { data } = await supabaseAdmin
      .from("discord_messages")
      .select("id, channel_id, author_name, content")
      .eq("project_key", p.key)
      .eq("answered", false)
      .order("created_at", { ascending: false })
      .limit(20);
    const rows = (data as
      | { id: number; channel_id: string; author_name?: string; content: string }[]
      | null) ?? [];
    const candidates = rows.filter((r) => looksLikeQuestion(r.content)).slice(0, max);
    if (!candidates.length) {
      // Mark the non-question backlog answered so it isn't rescanned forever.
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        await supabaseAdmin.from("discord_messages").update({ answered: true }).in("id", ids);
      }
      return 0;
    }
    let sent = 0;
    for (const r of candidates) {
      const { text } = await answerCommunityQuestion(p, r.content, "discord");
      if (text) {
        const res = await postToChannel(r.channel_id, {
          content: text,
          allowed_mentions: { parse: [] },
        });
        if (res.ok) sent++;
      }
      // Mark answered either way (a SKIP shouldn't be re-evaluated next tick).
      await supabaseAdmin.from("discord_messages").update({ answered: true }).eq("id", r.id);
    }
    return sent;
  } catch {
    return 0;
  }
}
