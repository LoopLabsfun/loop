import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// DAILY SOCIAL RECAP — a once-a-day build-in-public summary post.
//
// Per-ship posts (authorSocial at finish) cover individual milestones. This adds
// the periodic "here's what moved today" note for people who don't watch every
// tick: one authored, marketing-judged recap of the day's shipped work, posted to
// Telegram + Discord (NOT X — X stays rare/high-signal). Gated like the founder
// email digest: once per UTC day, official projects only, and only when there's
// enough shipped to be worth summarizing. Fully failure-safe — never throws.
//
// `shouldSendRecap` is the pure, testable gate; `sendDailyRecap` does the I/O.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from "./types";
import type { AgentState } from "./agent-data";
import { supabaseAdmin } from "./supabase";
import { digestDayKey } from "./agent-daily-digest";
import { loadSocialPlan, socialSilent } from "./agent-runtime";
import { authorRecap, recentOwnPosts } from "./agent-social";

/** Stable prefix marking a recap post — used for once-per-day idempotency. */
export const RECAP_TAG = "📊";

/** Default minimum ships in a day before a recap is worth posting. */
export const RECAP_MIN_SHIPS = 2;

/** Opt-OUT, like the founder digest: on unless explicitly disabled. */
export function recapEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.AGENT_DAILY_RECAP !== "0";
}

/**
 * Pure gate for the daily recap. Kept separate from I/O so the policy is unit-
 * testable. A recap goes out only for an official project that is socially ready
 * (not silent + has a content plan), hasn't already recapped today, and shipped
 * enough to be worth summarizing.
 */
export function shouldSendRecap(opts: {
  enabled: boolean;
  official: boolean;
  socialReady: boolean;
  shippedTodayCount: number;
  alreadySentToday: boolean;
  minShips?: number;
}): { ok: boolean; reason: string } {
  const min = opts.minShips ?? RECAP_MIN_SHIPS;
  if (!opts.enabled) return { ok: false, reason: "disabled" };
  if (!opts.official) return { ok: false, reason: "not an official project" };
  if (!opts.socialReady) return { ok: false, reason: "social not ready (silent or no plan)" };
  if (opts.alreadySentToday) return { ok: false, reason: "already recapped today" };
  if (opts.shippedTodayCount < min) {
    return { ok: false, reason: `only ${opts.shippedTodayCount} ship(s) today (<${min})` };
  }
  return { ok: true, reason: "ok" };
}

/**
 * Send the daily social recap for `p`, at most ONCE per UTC day. Self-guarding +
 * failure-safe (returns a note, never throws). Idempotency: a recap-tagged
 * telegram row for today already present ⇒ no-op.
 */
export async function sendDailyRecap(
  p: Project,
  state: AgentState,
  at: number = Date.now()
): Promise<{ sent: boolean; note: string }> {
  if (!recapEnabled()) return { sent: false, note: "disabled" };
  if (!p.official) return { sent: false, note: "not an official project" };
  if (!supabaseAdmin) return { sent: false, note: "no service-role client" };

  try {
    const silent = socialSilent();
    const plan = silent ? null : await loadSocialPlan(p);
    const socialReady = !silent && !!plan;

    const shipped =
      state.summaries.find((s) => s.day === "Today")?.shipped ?? [];

    // Idempotency: a recap-tagged telegram post already recorded today (UTC)?
    const dayStart = `${digestDayKey(at)}T00:00:00.000Z`;
    const { count } = await supabaseAdmin
      .from("agent_posts")
      .select("id", { count: "exact", head: true })
      .eq("project_key", p.key)
      .eq("platform", "telegram")
      .gte("created_at", dayStart)
      .ilike("body", `%${RECAP_TAG}%`);
    const alreadySentToday = (count ?? 0) > 0;

    const gate = shouldSendRecap({
      enabled: true,
      official: p.official,
      socialReady,
      shippedTodayCount: shipped.length,
      alreadySentToday,
    });
    if (!gate.ok) return { sent: false, note: gate.reason };

    const recent = await recentOwnPosts(p.key);
    const authored = await authorRecap(p, shipped, { plan, recent });
    if (!authored.text) return { sent: false, note: "recap author returned empty" };
    const body = `${RECAP_TAG} ${authored.text}`;

    let posted = 0;

    // Telegram → the build-log chat/topic (same routing as per-ship posts).
    const buildlogChat = process.env.TELEGRAM_BUILDLOG_CHAT_ID;
    const buildlogThread = Number(process.env.TELEGRAM_BUILDLOG_THREAD_ID) || undefined;
    const chatId = buildlogChat || process.env.TELEGRAM_CHAT_ID;
    if (chatId && process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const { sendTelegramMessage } = await import("./telegram-send");
        const { composeAgentMessage } = await import("./telegram");
        const text = composeAgentMessage(p, body);
        const res = await sendTelegramMessage(
          chatId,
          text,
          buildlogChat ? buildlogThread : undefined
        );
        if (res.ok) {
          await supabaseAdmin
            .from("agent_posts")
            .insert({ project_key: p.key, platform: "telegram", body: text });
          posted++;
        }
      } catch {
        /* telegram unavailable — never abort the recap */
      }
    }

    // Discord build-log (bot or webhook), same as per-ship posts.
    const discordBot = Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);
    if (process.env.DISCORD_WEBHOOK_URL || discordBot) {
      try {
        const { deliverBuildLog } = await import("./discord-send");
        const { composeAgentDiscord } = await import("./discord");
        const payload = composeAgentDiscord(p, body);
        const res = await deliverBuildLog(payload);
        if (res.ok) {
          await supabaseAdmin
            .from("agent_posts")
            .insert({ project_key: p.key, platform: "discord", body });
          posted++;
        }
      } catch {
        /* discord unavailable — never abort the recap */
      }
    }

    return posted > 0
      ? { sent: true, note: `recap posted to ${posted} channel(s) (${shipped.length} ships)` }
      : { sent: false, note: "no channel accepted the recap" };
  } catch (e) {
    return { sent: false, note: e instanceof Error ? e.message : "error" };
  }
}
