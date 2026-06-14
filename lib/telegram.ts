import type { Project, Commit } from "./types";
import type { AgentTask } from "./agent";
import { agentSlug, agentSite } from "./agent";

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM SEAM — read-only per-project build-update bot.
//
// Each project gets a dedicated **read-only** Telegram bot (`@<slug>_loop_bot`)
// that posts the agent's build progress — what shipped, commits, treasury — so a
// holder can add it and follow along without interacting. This module is the
// pure, testable part: bot identity + Telegram MarkdownV2 formatting of REAL
// agent state (no mock data — it formats whatever `agent_*` rows the runtime
// passes). The actual delivery (`sendMessage` to the Bot API) needs a
// `TELEGRAM_BOT_TOKEN` + a host, which is founder-provisioned — see
// docs/agent-runtime.md §5 (social). Keeping the formatter pure means the send
// path is a thin wrapper added later without touching this.
// ─────────────────────────────────────────────────────────────────────────────

// Telegram bot usernames must end in "bot"; we derive one deterministically from
// the project slug so it matches the email/social identities in lib/agent.ts.
export function telegramBotHandle(p: Pick<Project, "key" | "ticker">): string {
  return `@${agentSlug(p)}_loop_bot`;
}

export function telegramBotUrl(p: Pick<Project, "key" | "ticker">): string {
  return `https://t.me/${agentSlug(p)}_loop_bot`;
}

// MarkdownV2 reserves these characters; every one must be backslash-escaped in
// regular text or the Bot API rejects the message. (Inside code spans only ` and
// \ matter, but we only put safe content like commit hashes in code spans.)
const MDV2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!]/g;

export function escapeMarkdownV2(s: string): string {
  return s.replace(MDV2_SPECIAL, (c) => "\\" + c);
}

/** A build-progress snapshot for one update — all fields are real agent state. */
export interface BuildUpdate {
  /** Tasks shipped since the last update. */
  shipped?: AgentTask[];
  /** Commits pushed (most recent first). */
  commits?: Commit[];
  /** Current treasury balance in SOL. */
  treasurySol?: number;
  /** Net treasury change over the window in SOL (may be negative). */
  treasuryDeltaSol?: number;
}

const MAX_LINES = 5;

/**
 * Format a read-only build update for a project's Telegram bot, as MarkdownV2.
 * Returns the message text only (the caller pairs it with `parse_mode:
 * "MarkdownV2"`). Empty sections are omitted; an empty update still yields a
 * valid header + watch link.
 */
export function buildUpdateMessage(p: Project, u: BuildUpdate): string {
  const E = escapeMarkdownV2;
  const out: string[] = [`🤖 *${E(p.name)}* build update`];

  const shipped = (u.shipped ?? []).slice(0, MAX_LINES);
  if (shipped.length) {
    out.push("", "✅ *Shipped*");
    for (const t of shipped) out.push(`• ${E(t.title)}`);
  }

  const commits = u.commits ?? [];
  if (commits.length) {
    out.push("", `📦 *${commits.length} commit${commits.length === 1 ? "" : "s"}*`);
    for (const c of commits.slice(0, MAX_LINES)) out.push(`• ${E(c.message)}`);
  }

  if (typeof u.treasurySol === "number") {
    let delta = "";
    if (typeof u.treasuryDeltaSol === "number" && u.treasuryDeltaSol !== 0) {
      const sign = u.treasuryDeltaSol > 0 ? "+" : "";
      delta = ` \\(${E(sign + u.treasuryDeltaSol.toFixed(2))}\\)`;
    }
    out.push("", `💰 Treasury: *${E(u.treasurySol.toFixed(2))} SOL*${delta}`);
  }

  out.push("", `Watch it build → ${E(agentSite(p))}`);
  return out.join("\n");
}
