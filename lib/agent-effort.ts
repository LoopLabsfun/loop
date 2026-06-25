import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// AGENT EFFORT — let the agent judge HOW HARD to think per task, to save tokens
// without losing performance.
//
// The Claude Agent SDK session (scripts/agent-sdk-session.mjs) runs at Claude
// Code's default reasoning effort (high/xhigh) unless told otherwise — the most
// expensive setting, sized for hard engineering. Most of LOOP's backlog is small
// polish (guard a formatter, tweak copy, sum a value in a footer), which a `low`
// or `medium` effort ships just as well in far fewer tool-calls and tokens.
//
// This pure module maps a task → { effort, maxTurns } from complexity signals, so
// a trivial fix burns ~⅓ the tokens of a multi-file feature. Effort tracks
// COMPLEXITY, not priority: a high-priority typo still needs only `low` effort —
// task SELECTION (impact bias) is handled upstream in decideNextAction. Keeping
// this pure (no I/O) makes it unit-testable and free to call on every enqueue.
//
// Safety rails: AGENT_SDK_EFFORT forces a fixed level (kill-switch / experiment),
// and AGENT_SDK_MAX_TURNS stays the GLOBAL ceiling — the per-task maxTurns is
// clamped under it, so the founder's hard cap always wins.
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentTask } from "./agent";

/** Effort levels we use on Sonnet 4.6 (it supports low|medium|high|max; `xhigh`
 *  is Opus-only and `max` is overkill for this backlog, so we cap at high). */
export type SdkEffort = "low" | "medium" | "high";

const EFFORT_ORDER: SdkEffort[] = ["low", "medium", "high"];

/** Turn budget per effort level — the cost tail bound. Low tasks shouldn't need
 *  to wander; complex ones get room. Clamped under AGENT_SDK_MAX_TURNS below. */
const MAX_TURNS_BY_EFFORT: Record<SdkEffort, number> = { low: 12, medium: 24, high: 40 };

/** Mechanical / single-spot work — cheap, few turns. */
const LOW_SIGNALS = [
  "typo", "wording", "copy", "label", "caption", "tooltip", "placeholder",
  "comment", "rename", "guard", "clamp", "harden", "non-finite", "nan",
  "null check", "fallback", "default value", "format", "formatter", "lint",
  "tidy", "whitespace", "constant", "aria", "alt text", "a11y", "tweak",
  "spacing", "padding", "margin", "font size", "icon", "href", "one-line",
  "single line", "typecheck", "type error", "rename ", "wire up the link",
];

/** Broad / multi-file / design work — needs depth. */
const HIGH_SIGNALS = [
  "page", "route", "flow", "redesign", "refactor", "rework", "overhaul",
  "architecture", "system", "component", "integrate", "integration", "migrate",
  "migration", "pipeline", "end-to-end", "dashboard", "multiple", "across",
  "several files", "schema", "state machine", "websocket", "realtime",
  "engine", "rewrite", "restructure", "modal", "new section", "redesigned",
];

function countSignals(haystack: string, needles: readonly string[]): number {
  let n = 0;
  for (const s of needles) if (haystack.includes(s)) n += 1;
  return n;
}

/** Bump an effort level up by `steps` (clamped to the top). */
function bump(effort: SdkEffort, steps = 1): SdkEffort {
  const i = Math.min(EFFORT_ORDER.indexOf(effort) + steps, EFFORT_ORDER.length - 1);
  return EFFORT_ORDER[i];
}

function parseForcedEffort(raw: string | undefined): SdkEffort | null {
  const v = raw?.trim().toLowerCase();
  return v === "low" || v === "medium" || v === "high" ? v : null;
}

/** Global ceiling on turns, from AGENT_SDK_MAX_TURNS (default 40, hard-capped 100). */
function maxTurnsCeiling(env: Record<string, string | undefined>): number {
  const n = Number(env.AGENT_SDK_MAX_TURNS);
  const ceil = Number.isFinite(n) && n > 0 ? n : 40;
  return Math.min(ceil, 100);
}

export interface SdkEffortPlan {
  effort: SdkEffort;
  maxTurns: number;
  /** Short human-readable why, surfaced as a marker for observability. */
  reason: string;
}

/**
 * Decide the reasoning effort + turn budget for a code task. Pure.
 *
 * Order: an explicit AGENT_SDK_EFFORT override wins; otherwise classify by
 * keyword signals in the title+detail, with a one-level bump if the last attempt
 * on this task FAILED (it was harder than the cheap setting handled). The result
 * is always clamped under the AGENT_SDK_MAX_TURNS ceiling.
 */
export function effortForTask(
  task: Pick<AgentTask, "title" | "detail" | "category" | "lastOutcome">,
  env: Record<string, string | undefined> = process.env
): SdkEffortPlan {
  const ceiling = maxTurnsCeiling(env);
  const clamp = (turns: number) => Math.min(turns, ceiling);

  // 1. Explicit override — a fixed level for all tasks (kill-switch / experiment).
  const forced = parseForcedEffort(env.AGENT_SDK_EFFORT);
  if (forced) {
    return { effort: forced, maxTurns: clamp(MAX_TURNS_BY_EFFORT[forced]), reason: `forced ${forced}` };
  }

  // 2. Classify by complexity signals in the brief.
  const text = `${task.title} ${task.detail}`.toLowerCase();
  const hi = countSignals(text, HIGH_SIGNALS);
  const lo = countSignals(text, LOW_SIGNALS);

  let effort: SdkEffort;
  let why: string;
  if (hi > 0 && hi >= lo) {
    effort = "high";
    why = `complex (${hi} broad signal${hi > 1 ? "s" : ""})`;
  } else if (lo > hi) {
    effort = "low";
    why = `mechanical (${lo} scoped signal${lo > 1 ? "s" : ""})`;
  } else {
    // No strong signal: fixes tend to be scoped, features tend to be broader.
    effort = task.category === "fix" ? "low" : "medium";
    why = `default for ${task.category}`;
  }

  // 3. Retry harder: a previously-FAILED attempt proved the cheap setting wasn't
  //    enough — bump one level so the retry isn't starved (performance over a
  //    marginal token saving on a task we already know is hard).
  if (/\bfail/i.test(task.lastOutcome ?? "")) {
    const bumped = bump(effort);
    if (bumped !== effort) {
      why = `${why} → bumped after prior failure`;
      effort = bumped;
    }
  }

  return { effort, maxTurns: clamp(MAX_TURNS_BY_EFFORT[effort]), reason: why };
}
