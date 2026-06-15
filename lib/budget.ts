import type { Project } from "./types";
import { parseSolPerDay } from "./economics";

// ─────────────────────────────────────────────────────────────────────────────
// BUDGET HARD-STOP — the cost guardrail for the autonomous loop.
//
// The product bet, on-chain: "the token budget can absorb the waste" → an empty
// treasury means the agent SLEEPS; buyers refilling it WAKE it (docs/loop-roadmap
// thesis + Part D "hard stop"). This is the #2 guardrail after the verifier gate:
// it bounds spend so a starved or runaway project can't burn money unattended.
//
// Pure + testable. The scheduler calls `canAffordTick` to decide whether to tick
// a project at all; later the runtime can meter real per-cycle spend through the
// same seam.
// ─────────────────────────────────────────────────────────────────────────────

/** Cron cadence — one tick per project per hour (see vercel.json). */
export const TICKS_PER_DAY = 24;

/** Dust floor: below this the treasury is effectively empty (agent sleeps). */
export const MIN_TREASURY_SOL = 0.01;

/** Estimated SOL cost of one agent cycle (daily burn spread over the day). */
export function tickCostSol(p: Pick<Project, "burnPerDay">): number {
  return parseSolPerDay(p.burnPerDay) / TICKS_PER_DAY;
}

export interface TickBudget {
  /** True when the project can afford a cycle now. */
  ok: boolean;
  reason: string;
  treasurySol: number;
  /** SOL the treasury must hold to run a cycle. */
  needSol: number;
}

/**
 * Can this project afford an agent cycle now? It must hold at least one cycle's
 * burn, and at least the dust floor — so a near-empty treasury sleeps instead of
 * grinding to zero. `null`/invalid balances are treated as 0 (sleep).
 */
export function canAffordTick(
  p: Pick<Project, "treasurySol" | "burnPerDay">
): TickBudget {
  const treasurySol =
    typeof p.treasurySol === "number" && Number.isFinite(p.treasurySol) && p.treasurySol > 0
      ? p.treasurySol
      : 0;
  const needSol = Math.max(MIN_TREASURY_SOL, tickCostSol(p));
  if (treasurySol < needSol) {
    return {
      ok: false,
      reason: `sleeping · treasury ${treasurySol} SOL < ${needSol.toFixed(4)} needed for a cycle`,
      treasurySol,
      needSol,
    };
  }
  return {
    ok: true,
    reason: `funded · ${treasurySol} SOL (${needSol.toFixed(4)}/cycle)`,
    treasurySol,
    needSol,
  };
}
