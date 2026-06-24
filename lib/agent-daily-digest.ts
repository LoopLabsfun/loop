import "server-only";

import type { Project } from "./types";
import type { AgentTask, DailySummary, InboxMessage } from "./agent";
import type { FeedItem } from "./console";
import type { AgentState, WalletAction } from "./agent-data";
import { getRecentCommitsDated, type DatedCommit } from "./commits";
import { supabaseAdmin } from "./supabase";
import { isEmailConfigured, sendAgentEmail } from "./email-send";
import { outboundRow } from "./email-inbound";

// ─────────────────────────────────────────────────────────────────────────────
// DAILY FOUNDER DIGEST — a once-a-day recap email the agent sends to the project
// founder (FOUNDER_DIGEST_EMAIL, default hello@looplabs.fun): the day's build
// summary, the commits it pushed, the open community asks/proposals, and the
// other signals it has (unanswered mail, on-chain actions). Unlike the agent's
// outreach/reply mail, the recipient is a FIXED, founder-owned address — never
// model-chosen — so it carries no prompt-injection surface.
//
// `composeDailyDigest` is the pure, testable seam (no I/O); `sendDailyDigest`
// adds the once-per-day idempotency guard + send. Sent only for OFFICIAL projects
// and only when an email provider is configured; failure-safe (never aborts a tick).
// ─────────────────────────────────────────────────────────────────────────────

/** The founder mailbox the daily recap is sent to. */
export function founderDigestEmail(): string {
  return (process.env.FOUNDER_DIGEST_EMAIL || "hello@looplabs.fun")
    .trim()
    .toLowerCase();
}

/** UTC calendar-day key (YYYY-MM-DD) for `at` — the digest's date + idempotency key. */
export function digestDayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

export interface DigestInput {
  summaries: DailySummary[];
  tasks: AgentTask[];
  directives: FeedItem[];
  screenedDirectives: number;
  inbox: InboxMessage[];
  actions: WalletAction[];
  commits: DatedCommit[];
}

function bullet(lines: string[], empty: string): string {
  return lines.length ? lines.map((l) => `  • ${l}`).join("\n") : `  ${empty}`;
}

/**
 * Build the founder's daily-recap email (subject + plaintext body) from the day's
 * agent state. Pure: `at` fixes "today" (UTC) so commits/actions are filtered to
 * the day and the date is stable in tests. Always returns a digest — a quiet day
 * is reported honestly rather than skipped.
 */
export function composeDailyDigest(
  p: Pick<Project, "key" | "ticker" | "treasurySol" | "repo">,
  input: DigestInput,
  at: number = Date.now()
): { subject: string; text: string } {
  const day = digestDayKey(at);
  const dayStart = Date.parse(`${day}T00:00:00.000Z`);

  // Shipped today: prefer the honest per-day rollup ("Today"); fall back to tasks
  // currently marked shipped.
  const todaySummary = input.summaries.find((s) => s.day === "Today");
  const shipped =
    todaySummary?.shipped?.length
      ? todaySummary.shipped
      : input.tasks.filter((t) => t.status === "shipped").map((t) => t.title);
  const building = input.tasks
    .filter((t) => t.status === "building")
    .map((t) => t.title);

  // Commits pushed today (UTC), newest first, deduped by subject line.
  const seen = new Set<string>();
  const commitsToday = input.commits
    .filter((c) => c.date >= dayStart)
    .map((c) => c.msg.split("\n")[0].trim())
    .filter((m) => m && !seen.has(m) && seen.add(m));

  // Open community asks/proposals worth the founder's attention: not declined,
  // not already shipped, not founder-refused. Adopted-by-vote ones flagged.
  const asks = input.directives
    .filter(
      (d) =>
        (d.kind === "proposal" || d.kind === "directive") &&
        d.status !== "declined" &&
        d.exec !== "done" &&
        d.exec !== "refused"
    )
    .slice(0, 12)
    .map((d) => {
      const tag =
        d.status === "adopted"
          ? d.exec === "todo"
            ? "[adopted·queued] "
            : "[adopted by vote] "
          : "";
      const who = d.by ? ` — ${d.by}${d.verified ? " ✓" : ""}` : "";
      return `${tag}${d.text}${who}`;
    });

  const unanswered = input.inbox.filter(
    (m) => m.direction === "in" && !m.answered
  );
  const actionsToday = input.actions
    .slice(0, 8)
    .map((a) => `${a.kind} ${a.amountSol} SOL — ${a.disposition}`);

  const subject = `loop.fun — daily recap for ${p.ticker} · ${day}`;
  const text = [
    `Daily recap — ${p.ticker} (${p.key})`,
    day,
    "",
    `Treasury: ${p.treasurySol} SOL`,
    "",
    `SHIPPED TODAY (${shipped.length})`,
    bullet(shipped, "nothing shipped today"),
    "",
    `COMMITS PUSHED TODAY (${commitsToday.length})`,
    bullet(commitsToday, "no commits today"),
    "",
    `IN PROGRESS (${building.length})`,
    bullet(building, "nothing in flight"),
    "",
    `COMMUNITY ASKS & PROPOSALS (${asks.length})`,
    bullet(asks, "no open asks"),
    input.screenedDirectives > 0
      ? `  (${input.screenedDirectives} suspicious message(s) auto-screened out)`
      : null,
    "",
    `UNANSWERED MAIL (${unanswered.length})`,
    bullet(
      unanswered.slice(0, 8).map((m) => `${m.party} — "${m.subject}"`),
      "inbox clear"
    ),
    "",
    `ON-CHAIN ACTIONS (${actionsToday.length})`,
    bullet(actionsToday, "none"),
    "",
    `— your agent (${p.repo})`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n")
    .slice(0, 8000);

  return { subject, text };
}

/** True unless explicitly disabled — the founder recap is opt-OUT (safe recipient). */
export function digestEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.AGENT_DAILY_DIGEST !== "0";
}

/**
 * Send the founder's daily recap for `p`, at most ONCE per UTC day. Self-guarding:
 * only for official projects, only when email is configured + enabled, and a no-op
 * if today's digest already went out (idempotency via an `out` row to the founder
 * whose subject carries today's date key). Failure-safe — returns a note, never throws.
 */
export async function sendDailyDigest(
  p: Project,
  state: AgentState,
  at: number = Date.now()
): Promise<{ sent: boolean; note: string }> {
  if (!digestEnabled()) return { sent: false, note: "disabled" };
  if (!p.official) return { sent: false, note: "not an official project" };
  if (!isEmailConfigured()) return { sent: false, note: "email not configured" };
  if (!supabaseAdmin) return { sent: false, note: "no service-role client" };

  const to = founderDigestEmail();
  const day = digestDayKey(at);

  try {
    // Idempotency: today's recap already sent? (out row to the founder, subject
    // carries the date key). One per day, no matter how often the cron ticks.
    const { count } = await supabaseAdmin
      .from("agent_emails")
      .select("id", { count: "exact", head: true })
      .eq("project_key", p.key)
      .eq("direction", "out")
      .eq("party", to)
      .ilike("subject", `%${day}%`);
    if ((count ?? 0) > 0) return { sent: false, note: "already sent today" };

    let commits: DatedCommit[] = [];
    try {
      commits = await getRecentCommitsDated(p.repo, 50);
    } catch {
      /* commits unreadable — digest still goes out with [] */
    }

    const { subject, text } = composeDailyDigest(
      p,
      {
        summaries: state.summaries,
        tasks: state.tasks,
        directives: state.directives,
        screenedDirectives: state.screenedDirectives,
        inbox: state.inbox,
        actions: state.actions,
        commits,
      },
      at
    );

    const res = await sendAgentEmail(p, { to, subject, text });
    if (!res.ok) return { sent: false, note: res.error ?? "send failed" };

    await supabaseAdmin
      .from("agent_emails")
      .insert(outboundRow(p.key, { to, subject, text }));
    return { sent: true, note: `digest sent to ${to}` };
  } catch (e) {
    return { sent: false, note: e instanceof Error ? e.message : "error" };
  }
}
