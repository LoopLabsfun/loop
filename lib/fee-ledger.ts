import { distribute, type FeeSplit, type FeeDistribution } from "./fees";

// ─────────────────────────────────────────────────────────────────────────────
// FEE LEDGER — who can claim how much, after the agent sweeps creator fees.
//
// The claim flow: the agent claims pump.fun creator fees (lib/creator-fees.ts) →
// each swept amount is split per the project's FeeSplit → Loop custodies the
// totals → each role (founder / agent / platform) claims its share from the Loop
// UI. This module is the pure accounting: cumulative earned per role, minus what
// each role has already claimed, = what's claimable now. The runtime/DB persists
// the totals and records claims; this module computes the balances.
//
// Pure (no I/O), lamport-rounded so it never creates/loses dust. The DB table
// (per-project earned + claimed) is the activation step.
// ─────────────────────────────────────────────────────────────────────────────

export interface RoleTotals {
  founderSol: number;
  agentSol: number;
  platformSol: number;
}

export const ZERO_TOTALS: RoleTotals = {
  founderSol: 0,
  agentSol: 0,
  platformSol: 0,
};

// Lamport precision (1 SOL = 1e9 lamports) — matches lib/fees.ts.
function round9(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

/** Add one split distribution into running per-role totals. */
export function addDistribution(
  totals: RoleTotals,
  d: FeeDistribution
): RoleTotals {
  return {
    founderSol: round9(totals.founderSol + d.founderSol),
    agentSol: round9(totals.agentSol + d.agentSol),
    platformSol: round9(totals.platformSol + d.platformSol),
  };
}

/**
 * Apply a freshly-swept creator-fee amount (SOL) to the running earned totals,
 * splitting it by the project's fee split. The single call the runtime makes
 * after a successful collectCreatorFees().
 */
export function recordSweep(
  earned: RoleTotals,
  amountSol: number,
  split: FeeSplit
): RoleTotals {
  return addDistribution(earned, distribute(amountSol, split));
}

/** Sum a list of distributions into role totals (e.g. replaying a history). */
export function totalEarned(distributions: FeeDistribution[]): RoleTotals {
  return distributions.reduce(addDistribution, ZERO_TOTALS);
}

/**
 * Claimable now = earned − already claimed, per role, clamped at 0 (a claimed
 * figure should never exceed earned, but clamp defensively so the UI never shows
 * a negative claimable).
 */
export function claimable(earned: RoleTotals, claimed: RoleTotals): RoleTotals {
  const at = (e: number, c: number) => round9(Math.max(0, e - c));
  return {
    founderSol: at(earned.founderSol, claimed.founderSol),
    agentSol: at(earned.agentSol, claimed.agentSol),
    platformSol: at(earned.platformSol, claimed.platformSol),
  };
}
