import "server-only";

import { supabase, supabaseAdmin } from "./supabase";
import {
  type AgentTask,
  type DailySummary,
  type InboxMessage,
  type SocialPost,
  type TaskCategory,
  type TaskStatus,
} from "./agent";
import {
  rowToFeedItem,
  isAbusiveDirective,
  isSuspiciousDirective,
  proposalQuorum,
  resolveProposalOutcome,
  type DirectiveRow,
} from "./directives";
import { rowToChatMsg, type ChatRow, type ChatMsg } from "./chat";
import type { FeedItem } from "./console";
import {
  isDuplicateLearning,
  sanitizeLearning,
  type Learning,
  type LearningCategory,
} from "./learnings";
import type { Project } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// AGENT STATE — live read with per-panel fallback
//
// Reads the agent_* tables (written by the per-project runtime; see
// docs/agent-runtime.md) and maps them to the same shapes the UI already
// renders from lib/agent.ts. Each panel falls back to its seed independently:
// until the runtime writes rows for a project, that panel shows the simulated
// seed; the moment real rows exist, the panel goes live — no UI change needed.
// Mirrors the live/fallback pattern in lib/queries.ts. Server-only.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Has the project's runtime been active within `withinMs` (default 15 min)? Real
 * signal for the "Runtime active" status — the most recent of an agent_tasks tick
 * OR an agent_posts publish (the runtime writes one or the other every cycle), vs
 * the simulated engine flag (always false). Best-effort: false on no backend /
 * no rows / error.
 */
export async function isAgentActive(
  key: string,
  withinMs = 15 * 60 * 1000
): Promise<boolean> {
  if (!supabase) return false;
  const [tasks, posts] = await Promise.all([
    supabase
      .from("agent_tasks")
      .select("updated_at")
      .eq("project_key", key)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("agent_posts")
      .select("created_at")
      .eq("project_key", key)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const stamps = [
    (tasks.data as { updated_at?: string } | null)?.updated_at,
    (posts.data as { created_at?: string } | null)?.created_at,
  ]
    .filter((s): s is string => Boolean(s))
    .map((s) => new Date(s).getTime());
  if (!stamps.length) return false;
  return Date.now() - Math.max(...stamps) < withinMs;
}

export type WalletActionKind =
  | "buyback"
  | "burn"
  | "airdrop"
  | "bounty"
  | "swap";
export type WalletActionDisposition =
  | "executed"
  | "simulated"
  | "escalated"
  | "denied";

/** One on-chain position/action the agent took (or proposed) on its token. */
export interface WalletAction {
  id: string;
  kind: WalletActionKind;
  amountSol: number;
  disposition: WalletActionDisposition;
  txSig: string | null;
  note: string;
  at: string;
}

export interface AgentState {
  tasks: AgentTask[];
  inbox: InboxMessage[];
  social: SocialPost[];
  /** Honest per-day rollup derived from the task history (newest first; [] until any). */
  summaries: DailySummary[];
  /** Persisted steering directives/proposals, newest first ([] until any). Quarantined (suspicious) ones are excluded. */
  directives: FeedItem[];
  /** Count of directives auto-screened out (injection / fund-grab attempts). */
  screenedDirectives: number;
  /** Agent on-chain positions (buyback/burn/airdrop/bounty/swap), newest first. */
  actions: WalletAction[];
  /** True when at least one panel came from real rows this request. */
  live: boolean;
}

/** Compact relative-time label from an ISO timestamp. */
function rel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

interface TaskRow {
  id: number;
  title: string;
  detail: string;
  category: string;
  status: string;
  created_at: string;
  last_outcome?: string | null;
}
interface EmailRow {
  id: number;
  direction: string;
  party: string;
  subject: string;
  preview: string;
  created_at: string;
}
interface PostRow {
  id: number;
  platform: string;
  body: string;
  likes: number;
  replies: number;
  created_at: string;
}
interface ActionRow {
  id: number;
  kind: string | null;
  amount_sol: number | null;
  disposition: string | null;
  tx_sig: string | null;
  body: string | null;
  created_at: string;
}

const CATEGORIES: TaskCategory[] = ["feature", "outreach", "fix", "ops"];
const STATUSES: TaskStatus[] = ["todo", "building", "shipped", "blocked"];

/**
 * Honest daily rollup from the task history: for each recent day, the titles of
 * tasks that shipped, plus a note when nothing shipped that day. Derived from the
 * real `agent_tasks` rows — no separate table needed — so the Summary tab reflects
 * actual work instead of a dead "nothing yet".
 */
export function buildSummaries(rows: TaskRow[], now = Date.now()): DailySummary[] {
  const byDay = new Map<string, { shipped: string[]; worked: number }>();
  for (const r of rows) {
    const day = new Date(r.created_at).toISOString().slice(0, 10);
    const e = byDay.get(day) ?? { shipped: [], worked: 0 };
    e.worked += 1;
    if (r.status === "shipped" && !e.shipped.includes(r.title)) e.shipped.push(r.title);
    byDay.set(day, e);
  }
  const todayKey = new Date(now).toISOString().slice(0, 10);
  const yesterdayKey = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const label = (day: string) =>
    day === todayKey ? "Today" : day === yesterdayKey ? "Yesterday" : day;
  return Array.from(byDay.keys())
    .sort()
    .reverse()
    .slice(0, 5)
    .map((day) => {
      const e = byDay.get(day)!;
      return {
        id: `sum-${day}`,
        day: label(day),
        shipped: e.shipped.slice(0, 8),
        note: e.shipped.length
          ? ""
          : `Worked on ${e.worked} task${e.worked > 1 ? "s" : ""} — nothing shipped yet.`,
      };
    });
}

// Generic task words that carry no signal for "is this the same task?" — they
// appear in almost every title, so counting them inflates similarity.
const TITLE_STOP = new Set([
  "add",
  "the",
  "and",
  "for",
  "its",
  "new",
  "via",
  "into",
  "plus",
  "this",
  "that",
  "from",
  "onto",
  "today",
  "todays",
]);

/** Significant tokens of a task title (camelCase split, punctuation stripped). */
function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .replace(/([a-z])([A-Z])/g, "$1 $2") // budgetStatus → budget Status
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !TITLE_STOP.has(w))
  );
}

/** Jaccard overlap of two token sets (0..1). */
function titleSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  a.forEach((w) => {
    if (b.has(w)) inter++;
  });
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Collapse rows whose titles describe the same logical task. A stalled agent can
 * re-plan one feature across many ticks with slightly reworded titles ("Add
 * budget-status endpoint" / "Add budgetStatus helper + endpoint" / …) — exact
 * de-dup misses these and the panel fills with near-identical cards. Rows arrive
 * newest-first, so we keep the newest representative of each cluster. Pure +
 * exported for testing.
 */
export function dedupeSimilarTasks<T extends { title: string }>(
  rows: T[],
  threshold = 0.6
): T[] {
  const keptTokens: Set<string>[] = [];
  const out: T[] = [];
  for (const r of rows) {
    const tok = titleTokens(r.title);
    if (keptTokens.some((k) => titleSimilarity(tok, k) >= threshold)) continue;
    keptTokens.push(tok);
    out.push(r);
  }
  return out;
}

export async function getAgentState(p: Project): Promise<AgentState> {
  // No simulated seeds: until the runtime writes real agent_* rows, each panel
  // is honestly empty. The UI renders "nothing yet" empty states.
  const fallback: AgentState = {
    tasks: [],
    inbox: [],
    social: [],
    summaries: [],
    directives: [],
    screenedDirectives: 0,
    actions: [],
    live: false,
  };
  if (!supabase) return fallback;

  try {
    const [t, e, s, d, a] = await Promise.all([
      supabase
        .from("agent_tasks")
        .select("*")
        .eq("project_key", p.key)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("agent_emails")
        .select("*")
        .eq("project_key", p.key)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("agent_posts")
        .select("*")
        .eq("project_key", p.key)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("directives")
        .select("*")
        .eq("project_key", p.key)
        .order("created_at", { ascending: false })
        // Over-fetch: most rows may be quarantined spam, so pull a wider window
        // to still surface the genuine ones after screening (below).
        .limit(60),
      supabase
        .from("agent_actions")
        .select("*")
        .eq("project_key", p.key)
        .not("kind", "is", null)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    // Collapse rows for the same logical task — even when reworded across ticks
    // (see dedupeSimilarTasks) — so the panel shows each task once at its latest
    // state instead of a wall of near-identical "building" cards.
    const taskRows = (t.data as TaskRow[] | null) ?? [];
    const summaries = buildSummaries(taskRows);
    const tasks: AgentTask[] = dedupeSimilarTasks(taskRows)
      .map((r) => ({
        id: `t${r.id}`,
        title: r.title,
        detail: r.detail,
        category: CATEGORIES.includes(r.category as TaskCategory)
          ? (r.category as TaskCategory)
          : "feature",
        status: STATUSES.includes(r.status as TaskStatus)
          ? (r.status as TaskStatus)
          : "todo",
        at: rel(r.created_at),
        lastOutcome: r.last_outcome ?? undefined,
      }));

    const inbox: InboxMessage[] = ((e.data as EmailRow[] | null) ?? []).map(
      (r) => ({
        id: `m${r.id}`,
        direction: r.direction === "in" ? "in" : "out",
        party: r.party,
        subject: r.subject,
        preview: r.preview,
        at: rel(r.created_at),
      })
    );

    const social: SocialPost[] = ((s.data as PostRow[] | null) ?? []).map(
      (r) => ({
        id: `s${r.id}`,
        platform: r.platform as SocialPost["platform"],
        text: r.body,
        at: rel(r.created_at),
        likes: r.likes ?? 0,
        replies: r.replies ?? 0,
      })
    );

    // Screen out quarantined directives (prompt-injection / fund-grab attempts)
    // at the source: neither the public feed nor the agent's prompt should carry
    // them. `screenedDirectives` reports how many were caught in this window —
    // a transparency signal, not a vector. Genuine suggestions are kept.
    // Moderated rows (auto-hidden abuse or founder-hidden) are dropped at the
    // source — their text never reaches a client payload, so "hide" is real, not
    // just visual. The row stays in the table for traceability/restore. We also
    // auto-hide obvious abuse by content here, so existing slurs/harassment vanish
    // immediately without waiting for a write (the agent persists hidden=true on
    // its next tick; this read-time filter makes it instant + write-free).
    const allDirectives = ((d.data as DirectiveRow[] | null) ?? []).filter(
      (r) => !r.hidden && !isAbusiveDirective(r.text)
    );
    // Surface every proposal against the LIVE holder-proportional quorum (~1/10),
    // overriding whatever value was frozen on the row at submit time — so old
    // proposals stuck at quorum 100 show the same reachable bar as new ones.
    const liveQuorum = proposalQuorum(p.holders);
    const keptDirectives = allDirectives
      .map((r) => rowToFeedItem(r, rel(r.created_at), liveQuorum))
      .filter((item) => !item.flagged);
    const screenedDirectives = allDirectives.length - keptDirectives.length;
    const directives: FeedItem[] = keptDirectives.slice(0, 20);

    const ACTION_KINDS: WalletActionKind[] = [
      "buyback",
      "burn",
      "airdrop",
      "bounty",
      "swap",
    ];
    const DISPOSITIONS: WalletActionDisposition[] = [
      "executed",
      "simulated",
      "escalated",
      "denied",
    ];
    const actions: WalletAction[] = ((a.data as ActionRow[] | null) ?? [])
      .filter((r) => ACTION_KINDS.includes(r.kind as WalletActionKind))
      .map((r) => ({
        id: `a${r.id}`,
        kind: r.kind as WalletActionKind,
        amountSol: r.amount_sol ?? 0,
        disposition: DISPOSITIONS.includes(r.disposition as WalletActionDisposition)
          ? (r.disposition as WalletActionDisposition)
          : "simulated",
        txSig: r.tx_sig ?? null,
        note: r.body ?? "",
        at: rel(r.created_at),
      }));

    return {
      tasks,
      inbox,
      social,
      summaries,
      directives,
      screenedDirectives,
      actions,
      live:
        tasks.length > 0 ||
        inbox.length > 0 ||
        social.length > 0 ||
        directives.length > 0 ||
        actions.length > 0,
    };
  } catch {
    return fallback;
  }
}

interface ProposalRow {
  id: string;
  text: string;
  for_votes: number | null;
  against_votes: number | null;
  hidden: boolean | null;
}

/**
 * Auto-resolve the project's open proposals the way a founder would, but WITHOUT
 * a human: the moment a proposal clears the live holder-proportional quorum
 * (~1/10, see proposalQuorum) with a majority, it's marked `adopted` (majority
 * for) or `declined` (majority against). This is the governance half of the
 * agent's autonomy — "the bot decides on its own once 1/10 have voted" — and it
 * runs every cron tick for EVERY project, funded or not (it's a free DB pass, no
 * Claude call), so steering resolves even while the agent sleeps.
 *
 * Safety: skips hidden/abusive/injection rows (those never become an endorsed
 * directive), and an adopted proposal is still only *steering* — the agent's
 * non-negotiable SECURITY floor means it can never move funds or change its
 * mandate from one. Service-role; never throws — a bookkeeping failure here must
 * not abort the cron. Returns the count resolved this pass.
 */
export async function resolveDueProposals(p: Project): Promise<number> {
  if (!supabaseAdmin) return 0;
  try {
    const { data } = await supabaseAdmin
      .from("directives")
      .select("id, text, for_votes, against_votes, hidden")
      .eq("project_key", p.key)
      .eq("kind", "proposal")
      .eq("status", "open")
      .limit(100);
    const rows = (data as ProposalRow[] | null) ?? [];
    const quorum = proposalQuorum(p.holders);
    let resolved = 0;
    for (const r of rows) {
      if (r.hidden || isAbusiveDirective(r.text) || isSuspiciousDirective(r.text)) {
        continue;
      }
      const outcome = resolveProposalOutcome(
        r.for_votes ?? 0,
        r.against_votes ?? 0,
        quorum
      );
      if (!outcome) continue;
      // Guard on status=open so a concurrent founder resolution wins (no clobber).
      const { error } = await supabaseAdmin
        .from("directives")
        .update({ status: outcome })
        .eq("id", r.id)
        .eq("status", "open");
      if (!error) resolved++;
    }
    return resolved;
  } catch {
    return 0;
  }
}

/**
 * Recent paid chat with the project's agent (newest first), for the chat panel.
 * Public read (the Q&A is transparent). Returns [] if unconfigured or on failure.
 */
export async function getChat(key: string, limit = 24): Promise<ChatMsg[]> {
  if (!supabase) return [];
  try {
    const { data } = await supabase
      .from("agent_chat")
      .select("*")
      .eq("project_key", key)
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data as ChatRow[] | null) ?? []).map((r) =>
      rowToChatMsg(r, rel(r.created_at))
    );
  } catch {
    return [];
  }
}

/**
 * Add real claimed creator fees to a project's cumulative `earned_sol` (the
 * "Total earned" line). Called from the cron after a successful pump.fun fee
 * claim with the measured SOL delta, so earned reflects actual revenue instead
 * of a dead 0. Read-then-write (the cron is single-threaded, so no race);
 * service-role; never throws — a bookkeeping failure must not abort the tick.
 * Returns the new total, or null if unconfigured/failed/zero.
 */
export async function addEarnedSol(
  key: string,
  sol: number
): Promise<number | null> {
  if (!supabaseAdmin || !(sol > 0)) return null;
  try {
    const { data } = await supabaseAdmin
      .from("projects")
      .select("earned_sol")
      .eq("key", key)
      .maybeSingle();
    const current = (data as { earned_sol?: number } | null)?.earned_sol ?? 0;
    const next = current + sol;
    const { error } = await supabaseAdmin
      .from("projects")
      .update({ earned_sol: next })
      .eq("key", key);
    return error ? null : next;
  } catch {
    return null;
  }
}

interface LearningRow {
  id: string;
  category: string;
  insight: string;
  source: string;
  upvotes: number;
  created_at: string;
}

/**
 * Top cross-project learnings (A5), highest-upvoted first. Read by every agent
 * tick and surfaced in the UI. Returns [] if unconfigured or on failure — the
 * caller treats an empty layer as "no shared learnings yet".
 */
export async function getTopLearnings(limit = 6): Promise<Learning[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("learnings")
      .select("*")
      .order("upvotes", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as LearningRow[]).map((r) => ({
      id: r.id,
      category: r.category as LearningCategory,
      insight: r.insight,
      source: r.source,
      upvotes: r.upvotes,
      at: r.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Write a self-generated learning back to the shared layer (C — closes the A5
 * loop). Service-role write; needs SUPABASE_SERVICE_ROLE_KEY. Skips empties and
 * near-duplicates of the most recent rows so the agent can't flood the table.
 * Returns true if a row was inserted. Never throws — a failure here must not
 * abort the tick.
 */
export async function recordLearning(
  category: LearningCategory,
  insight: string,
  source = "a project"
): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const clean = sanitizeLearning(insight);
  if (!clean) return false;
  try {
    // Dedupe against the recent layer (by punctuation-insensitive key).
    const { data } = await supabaseAdmin
      .from("learnings")
      .select("insight")
      .order("created_at", { ascending: false })
      .limit(100);
    if (isDuplicateLearning(clean, (data as { insight: string }[]) ?? [])) {
      return false;
    }
    const { error } = await supabaseAdmin
      .from("learnings")
      .insert({ category, insight: clean, source });
    return !error;
  } catch {
    return false;
  }
}
