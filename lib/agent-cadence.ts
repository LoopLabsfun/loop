// ─────────────────────────────────────────────────────────────────────────────
// AGENT TICK CADENCE — each project paces its OWN ticks from its live state.
//
// The flat global cooldown (lib/agent-tick-throttle) ticks every project at one
// fixed rate regardless of whether it has hot work or is idle/stuck — which both
// wastes Claude credit on projects with nothing to do AND under-serves a project
// mid-sprint. This computes a PER-PROJECT interval from the project's own signals,
// so the agent effectively decides how often it runs:
//
//   • demand     — open backlog + unanswered inbound ⇒ tick sooner (down to 0.5×)
//   • idleness   — nothing queued and nothing building ⇒ back off hard (slow down)
//   • congestion — many tasks stuck "building"/"blocked" not clearing ⇒ stop
//                  piling on, back off so they can resolve (or be reconciled)
//   • runway     — thin treasury ⇒ stretch the cadence to conserve burn
//
// `AGENT_TICK_COOLDOWN_MIN` stays the BASE (neutral) cadence; the factors move
// around it, clamped to a hard floor (never burns faster than minMin) and ceiling
// (a funded project never sleeps longer than maxMin before its next look). Pure,
// no I/O, fully unit-tested. The cron pairs it with `lastTickAt` (lib/agent-data):
// skip a project until `now - lastTick ≥ cadence`. AGENT_PAUSED + the empty-
// treasury budget gate remain the hard stops; this only modulates the rate.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_TICK_COOLDOWN_MIN } from "./agent-tick-throttle";

/** Absolute fastest any project ticks (cost floor), minutes. */
export const DEFAULT_MIN_CADENCE_MIN = 15;
/** Slowest a funded project waits before its next look, minutes (12h). */
export const DEFAULT_MAX_CADENCE_MIN = 720;

export interface CadenceSignals {
  /** Live treasury balance, SOL. */
  treasurySol: number;
  /** SOL the treasury must hold to afford a cycle (canAffordTick.needSol). */
  needSol: number;
  /** Tasks queued and ready to start (status "todo"). */
  openTodos: number;
  /** Tasks mid-flight (status "building" or "blocked"). */
  inFlight: number;
  /** Unanswered inbound messages (email/community) awaiting the agent. */
  unansweredInbound: number;
}

export interface CadenceBounds {
  /** Neutral cadence the factors move around, minutes. */
  baseMin: number;
  /** Hard floor — never tick faster than this, minutes. */
  minMin: number;
  /** Ceiling — never wait longer than this when funded, minutes. */
  maxMin: number;
}

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;

/** Resolve the cadence bounds from env (all optional, sensible defaults). */
export function cadenceBounds(
  env: Record<string, string | undefined> = process.env
): CadenceBounds {
  const base = (() => {
    const raw = env.AGENT_TICK_COOLDOWN_MIN?.trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TICK_COOLDOWN_MIN;
  })();
  const minMin = num(Number(env.AGENT_TICK_MIN_MIN), DEFAULT_MIN_CADENCE_MIN);
  const maxMin = num(Number(env.AGENT_TICK_MAX_MIN), DEFAULT_MAX_CADENCE_MIN);
  return {
    baseMin: base,
    minMin: Math.min(minMin, maxMin),
    maxMin: Math.max(minMin, maxMin),
  };
}

/**
 * Minutes the project should wait between ticks, from its live state. Pure: the
 * base cadence scaled by demand / idleness / congestion / runway factors, clamped
 * to [minMin, maxMin]. A project with hot, fundable work ticks near minMin; an
 * idle or thin-treasury one stretches toward maxMin.
 */
export function tickCadenceMinutes(
  s: CadenceSignals,
  bounds: CadenceBounds
): number {
  const openWork = Math.max(0, s.openTodos) + Math.max(0, s.unansweredInbound);
  const inFlight = Math.max(0, s.inFlight);

  let m = bounds.baseMin;

  // Demand: lots ready to do ⇒ sooner; nothing ready ⇒ slower (and much slower
  // when nothing is building either — the project is genuinely idle).
  if (openWork >= 3) m *= 0.5;
  else if (openWork >= 1) m *= 0.8;
  else m *= inFlight === 0 ? 4 : 1.5;

  // Congestion: a pile of unfinished work that isn't clearing ⇒ ease off so it
  // resolves (or the queue-reconcile sweep lands) instead of stacking more.
  if (inFlight >= 8) m *= 2;
  else if (inFlight >= 5) m *= 1.5;

  // Runway: thin treasury ⇒ stretch to conserve burn; comfortable ⇒ leave as is.
  const ratio = s.needSol > 0 ? s.treasurySol / s.needSol : s.treasurySol;
  if (ratio < 1.5) m *= 1.5;

  return Math.round(Math.min(bounds.maxMin, Math.max(bounds.minMin, m)));
}
