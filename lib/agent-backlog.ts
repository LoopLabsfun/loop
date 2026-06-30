import type { AgentTask, TaskCategory, TaskSource } from "./agent";

export type { TaskSource };

// The agent's BACKLOG as the source of truth for "what to build next", plus the
// altitude check that defines "done" as a user-visible change.
//
// The agent ships real code, but its recurring failure mode is JUDGMENT: left to
// freely pick among a flat todo list it drifts into low-value micro-polish
// (re-hardening util/formatter helpers, test-only tweaks). lib/agent-runtime's
// prompt fights this with an ever-growing wall of rules. This module fixes it
// structurally instead:
//
//   1. rankBacklog — the todo queue is RANKED by curated priority (founder/holder
//      asks outrank agent-groomed busywork), so the agent pulls a deterministic
//      TOP item rather than re-deriving "what should I do" each tick.
//   2. classifyChangedPaths / isBusyworkOnly — after a code tick, the diff is
//      graded: a change that touched ONLY trivial files (tests, docs, scripts,
//      config, the already-hardened util family) while real work was queued is
//      flagged as a non-increment, so it never counts as the tick's work.
//
// Pure (no I/O) so it's unit-testable and identical on every code path.

/** A backlog item carries a curated priority + source on top of AgentTask. */
export interface RankedTask extends AgentTask {
  priority: number;
  source: TaskSource;
}

/** Default priority band per source when none is set — founder/holder asks float
 *  above agent self-groomed work so curated direction always wins the tick. */
export const SOURCE_BASE_PRIORITY: Record<TaskSource, number> = {
  founder: 100,
  holder: 50,
  agent: 0,
};

// An unprioritised agent-groomed task (band 0) sits behind EVERY founder/holder
// ask forever, no matter how long it's waited — a fresh founder ask always
// outranks it. This grows its effective priority a little per day it's been open
// so old, neglected agent work eventually surfaces among its peers instead of
// starving indefinitely. Capped well under the holder band (50) so founder/holder
// curated direction still always wins the tick — this only reorders among
// otherwise-equal agent-groomed busywork.
const STALENESS_BOOST_PER_DAY = 2;
const STALENESS_BOOST_CAP = 20;

/** The effective priority used for ordering: an explicit priority wins; otherwise
 *  fall back to the source's base band, plus a capped staleness boost for
 *  unprioritised agent-groomed tasks that have aged in the open backlog. */
export function effectivePriority(
  t: { priority?: number | null; source?: TaskSource | null; createdAtMs?: number | null },
  nowMs = Date.now()
): number {
  if (typeof t.priority === "number" && Number.isFinite(t.priority)) return t.priority;
  const base = SOURCE_BASE_PRIORITY[t.source ?? "agent"];
  if ((t.source ?? "agent") !== "agent" || !t.createdAtMs) return base;
  const days = Math.max(0, (nowMs - t.createdAtMs) / 86_400_000);
  return base + Math.min(STALENESS_BOOST_CAP, Math.floor(days) * STALENESS_BOOST_PER_DAY);
}

const ALL_CATEGORIES: TaskCategory[] = ["feature", "outreach", "fix", "ops"];

// Category fairness: a category with NO shipped task in the recent-shipped
// window is "starved" relative to the others and gets a modest nudge — without
// this, a steady stream of (higher-band) founder `feature` asks can bury
// `fix`/`ops` work indefinitely, since priority bands alone never let category
// mix self-correct. Capped well under the holder band (50) so it only reorders
// among same-band work, never overrides curated founder/holder direction.
const CATEGORY_FAIRNESS_LOOKBACK = 6;
const CATEGORY_FAIRNESS_BOOST = 15;

/**
 * Rank the actionable backlog (the `todo` items) highest-impact first:
 * effective priority desc (plus the category-fairness nudge above), then a
 * stable tiebreak that preserves the incoming order (callers pass oldest-first
 * within a band to avoid starvation). Returns the ordered queue and the single
 * `top` item the agent should work unless a higher-priority steering item is
 * open. `tasks` may include non-`todo` rows (e.g. recently shipped) — only used
 * here to derive category fairness; they're excluded from the ranked output.
 */
export function rankBacklog<
  T extends {
    status: string;
    priority?: number | null;
    source?: TaskSource | null;
    category?: TaskCategory | null;
    createdAtMs?: number | null;
  },
>(tasks: T[]): { ranked: T[]; top: T | null } {
  const todo = tasks.filter((t) => t.status === "todo");

  const recentShipped = tasks.filter((t) => t.status === "shipped").slice(0, CATEGORY_FAIRNESS_LOOKBACK);
  const shippedCategories = new Set(recentShipped.map((t) => t.category).filter(Boolean));
  const starved = new Set(ALL_CATEGORIES.filter((c) => !shippedCategories.has(c)));
  const fairnessBoost = (t: T) => (t.category && starved.has(t.category) ? CATEGORY_FAIRNESS_BOOST : 0);

  // Decorate with the original index so the sort is stable across engines.
  const ranked = todo
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const pd =
        effectivePriority(b.t) + fairnessBoost(b.t) - (effectivePriority(a.t) + fairnessBoost(a.t));
      return pd !== 0 ? pd : a.i - b.i;
    })
    .map((x) => x.t);
  return { ranked, top: ranked[0] ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Altitude / definition-of-done
// ─────────────────────────────────────────────────────────────────────────────

export interface SurfaceClassification {
  /** Paths a holder can SEE or FEEL — pages, components, styling. */
  visible: string[];
  /** Real but not directly visible — API routes, business logic, migrations. */
  functional: string[];
  /** Low-altitude: tests, docs, scripts, config, the hardened util family. */
  trivial: string[];
}

// The already-thoroughly-hardened util family the agent must treat as DONE
// (named explicitly in the runtime prompt). A change confined to these is the
// canonical busywork pattern.
const HARDENED_UTILS = new Set(["lib/format.ts"]);

function norm(path: string): string {
  return path.replace(/^\.?\//, "").trim();
}

/** Which bucket a single changed file falls into. */
export function classifyPath(path: string): keyof SurfaceClassification {
  const p = norm(path);
  // Styling/theme is holder-visible — check it before the generic config rule so
  // tailwind.config.ts isn't mistaken for build config.
  if (p === "app/globals.css" || p === "tailwind.config.ts") return "visible";
  // Trivial next — tests/docs/scripts/config/util are low-altitude regardless of
  // where they live.
  if (/\.(test|spec)\.[tj]sx?$/.test(p)) return "trivial";
  if (p.startsWith("docs/") || p.endsWith(".md")) return "trivial";
  if (p.startsWith("scripts/")) return "trivial";
  if (p.startsWith(".github/") || p.startsWith("supabase/")) return "trivial";
  if (/(^|\/)(package(-lock)?\.json|tsconfig.*\.json|.*\.config\.(t|j)s|\.env.*)$/.test(p)) return "trivial";
  if (HARDENED_UTILS.has(p)) return "trivial";

  // Visible — what a holder actually sees. App pages/layouts (not API) and all
  // components (styling/theme handled above).
  if (p.startsWith("app/") && !p.startsWith("app/api/")) return "visible";
  if (p.startsWith("components/")) return "visible";

  // Everything else (API routes, lib logic, etc.) is real, functional work.
  return "functional";
}

/** Bucket a set of changed paths into visible / functional / trivial surfaces. */
export function classifyChangedPaths(paths: string[]): SurfaceClassification {
  const out: SurfaceClassification = { visible: [], functional: [], trivial: [] };
  for (const path of paths) {
    if (!path || !path.trim()) continue;
    out[classifyPath(path)].push(norm(path));
  }
  return out;
}

/**
 * True when a code tick's diff is busywork: it touched ONLY trivial files (and
 * at least one). That's the exact non-increment the agent must stop shipping when
 * real, higher-altitude work is queued — a tick whose entire change is a util
 * re-harden or a test-only tweak.
 */
export function isBusyworkOnly(paths: string[]): boolean {
  const c = classifyChangedPaths(paths);
  return c.visible.length === 0 && c.functional.length === 0 && c.trivial.length > 0;
}
