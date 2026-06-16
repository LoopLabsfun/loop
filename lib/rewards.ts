import type { Holder, Payout } from "./types";
import { windDownDistribution } from "./governance";

// ─────────────────────────────────────────────────────────────────────────────
// REWARDS — how value reaches people, on-chain (no fiat revenue).
//
// A project's value accrues on-chain: token appreciation, **airdrops to
// holders**, and **bounties** (paying real contributors for completed work).
// This is the pure, testable decision seam the on-chain layer executes.
//   - airdropDistribution: split a chosen SOL amount pro-rata across holders
//     (same math as a wind-down, but for a partial amount — dust-exact).
//   - canPayBounty: a bounty pays only for **verified** work within budget,
//     tying payouts to the A1 verifier gate (no money for unverified "done").
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distribute `amountSol` pro-rata to holders by their share of supply. Reuses
 * the wind-down math (normalised shares, dust absorbed into the last payout) so
 * the parts sum to `amountSol` exactly.
 */
export function airdropDistribution(
  amountSol: number,
  holders: Holder[]
): Payout[] {
  return windDownDistribution(amountSol, holders);
}

export type BountyStatus = "open" | "claimed" | "paid" | "cancelled";

export interface Bounty {
  id: string;
  /** SOL paid to the contributor on verified completion. */
  rewardSol: number;
  status: BountyStatus;
}

export interface BountyDecision {
  ok: boolean;
  reason: string;
}

/**
 * May a bounty pay out? Only a *claimed* bounty, with a positive reward within
 * the treasury balance, AND whose work was independently **verified** — so a
 * bounty can never pay for unverified "done" (mirrors the maker ≠ checker gate).
 */
export function canPayBounty(opts: {
  bounty: Bounty;
  treasurySol: number;
  verified: boolean;
}): BountyDecision {
  const { bounty, treasurySol, verified } = opts;
  if (bounty.status !== "claimed") {
    return { ok: false, reason: `bounty is ${bounty.status}, not claimed` };
  }
  if (!(bounty.rewardSol > 0)) {
    return { ok: false, reason: "reward must be positive" };
  }
  if (bounty.rewardSol > treasurySol) {
    return { ok: false, reason: "reward exceeds the treasury balance" };
  }
  if (!verified) {
    return { ok: false, reason: "work is not verified — no payout (maker ≠ checker)" };
  }
  return { ok: true, reason: "approved — verified claim within budget" };
}
