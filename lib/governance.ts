import type { Holder, Payout } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// GOVERNED TREASURY — no funds are ever stuck.
//
// A project's treasury is a **governed vault** (on-chain: Squads v4 multisig or
// Realms/SPL-Governance). This module is the pure, testable *decision* seam the
// on-chain layer executes — so the "no stuck funds" guarantee is code-backed,
// not just a promise. Three exits, so SOL is never permanently locked:
//
//   1. **operating spend** — the agent spends within its budget (see budget.ts);
//   2. **founder withdrawal** — allowed ONLY when a holder vote passes
//      (quorum + majority); the founder can never unilaterally drain it;
//   3. **wind-down** — an abandoned/closed project redistributes its treasury
//      pro-rata to token holders.
//
// This replaces the old "permanent, never refunded" model. Pure (no deps / no
// I/O), so the runtime + an on-chain executor plug straight in.
// ─────────────────────────────────────────────────────────────────────────────

export type ProposalKind = "withdrawal" | "wind_down";

export interface VoteTally {
  forVotes: number;
  againstVotes: number;
  /** Minimum total votes for the proposal to be valid. */
  quorum: number;
}

/** Pure: has a governance vote passed? Quorum met AND a strict majority for. */
export function votePassed(t: VoteTally): boolean {
  const forV = Math.max(0, t.forVotes);
  const againstV = Math.max(0, t.againstVotes);
  return forV + againstV >= t.quorum && forV > againstV;
}

export interface WithdrawalRequest {
  /** SOL the founder asks to withdraw from the treasury. */
  amountSol: number;
  recipient: string;
  vote: VoteTally;
}

export interface Decision {
  ok: boolean;
  reason: string;
}

/**
 * Pure: may a founder withdrawal execute? It needs a positive amount within the
 * balance AND a passed holder vote — so treasury SOL can leave, but never
 * unilaterally.
 */
export function canWithdraw(
  treasurySol: number,
  req: WithdrawalRequest
): Decision {
  if (!(req.amountSol > 0)) return { ok: false, reason: "amount must be positive" };
  if (req.amountSol > treasurySol)
    return { ok: false, reason: "amount exceeds the treasury balance" };
  if (!votePassed(req.vote))
    return {
      ok: false,
      reason: "holder vote has not passed (needs quorum + majority)",
    };
  return { ok: true, reason: "approved by holder vote" };
}

/**
 * Pure: wind-down distribution — split the treasury pro-rata across holders by
 * their share of supply, so nothing stays locked when a project closes. Shares
 * are normalised (need not sum to 1); the last payout absorbs rounding dust so
 * the payouts sum to `treasurySol` exactly.
 */
export function windDownDistribution(
  treasurySol: number,
  holders: Holder[]
): Payout[] {
  const valid = holders.filter((h) => h.share > 0);
  const totalShare = valid.reduce((a, h) => a + h.share, 0);
  if (treasurySol <= 0 || totalShare <= 0) return [];

  const out: Payout[] = valid.map((h) => ({
    address: h.address,
    sol: (treasurySol * h.share) / totalShare,
  }));
  // Absorb floating-point dust into the last payout so the total is exact.
  const dust = treasurySol - out.reduce((a, p) => a + p.sol, 0);
  out[out.length - 1].sol += dust;
  return out;
}
