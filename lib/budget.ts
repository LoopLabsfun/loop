import type { Project } from "./types";
import type { Chain } from "./chains/types";
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

/** Spot rates used to express every chain's treasury in one unit. */
export interface FxRates {
  solUsd: number;
  ethUsd: number;
}

/**
 * A project's treasury across ALL its chains, in SOL-equivalent — the number the
 * runway gate should use once a project is multichain.
 *
 * "One project, one agent, funded by any of its chains" (lib/chains/deployments)
 * only holds if the budget gate can SEE the other chains: otherwise funding the
 * Hood treasury leaves the agent asleep because `treasurySol` is the home
 * chain's balance alone. Native balances aren't comparable (SOL vs ETH), so each
 * is converted through USD. A missing/invalid rate makes that chain contribute
 * 0 rather than a fabricated amount — the gate errs toward sleeping, never
 * toward spending on a balance we couldn't price.
 */
export function crossChainTreasurySol(
  deployments: { chain: Chain; treasuryNative: number }[],
  fx: FxRates
): number {
  const solUsd = Number.isFinite(fx.solUsd) && fx.solUsd > 0 ? fx.solUsd : 0;
  const ethUsd = Number.isFinite(fx.ethUsd) && fx.ethUsd > 0 ? fx.ethUsd : 0;
  if (solUsd <= 0) return 0;
  let usd = 0;
  for (const d of deployments) {
    const bal =
      typeof d.treasuryNative === "number" && Number.isFinite(d.treasuryNative) && d.treasuryNative > 0
        ? d.treasuryNative
        : 0;
    if (bal <= 0) continue;
    usd += bal * (d.chain === "hood" ? ethUsd : solUsd);
  }
  return usd / solUsd;
}

/**
 * Can this project afford an agent cycle now? It must hold at least one cycle's
 * burn, and at least the dust floor — so a near-empty treasury sleeps instead of
 * grinding to zero. `null`/invalid balances are treated as 0 (sleep).
 *
 * Reads `treasurySolTotal` (every chain, SOL-equivalent) when the read path
 * computed one, so a multichain project funded on ANY chain wakes up; falls back
 * to the home chain's `treasurySol` for single-chain projects and for callers
 * that build a Project by hand.
 */
export function canAffordTick(
  p: Pick<Project, "treasurySol" | "treasurySolTotal" | "burnPerDay">
): TickBudget {
  const effective = typeof p.treasurySolTotal === "number" ? p.treasurySolTotal : p.treasurySol;
  const treasurySol =
    typeof effective === "number" && Number.isFinite(effective) && effective > 0
      ? effective
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

/** Honest agent run-state for the UI, derived from the same gate the cron uses. */
export type AgentRunState = "pre-launch" | "asleep" | "active";

/**
 * What the agent is actually doing, for the status badge:
 * - `pre-launch` — token not minted yet (no market, nothing to run on);
 * - `asleep` — minted but the treasury can't afford a cycle (cron skips it);
 * - `active` — treasury funds cycles, so the scheduler ticks it.
 *
 * NB: the gate is the **treasury** (`treasurySol`), not the agent's own wallet —
 * funding the agent wallet enables buybacks, it does not wake the agent.
 */
export function agentRunState(
  p: Pick<Project, "mint" | "treasurySol" | "treasurySolTotal" | "burnPerDay">
): AgentRunState {
  if (!p.mint) return "pre-launch";
  return canAffordTick(p).ok ? "active" : "asleep";
}
