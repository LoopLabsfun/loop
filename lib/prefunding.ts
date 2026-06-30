// ─────────────────────────────────────────────────────────────────────────────
// PRE-LAUNCH FUNDING — the "vote with SOL" accounting (pure, no I/O).
//
// A whitelisted project gets a Loop-custodial Privy wallet (its future on-chain
// creator/treasury). Backers send SOL to that wallet BEFORE the mint — a conviction
// deposit ("yes, Loop should launch this"). At approval the balance seeds the
// project (candle + agent runway); if the project is rejected / never launches, it
// is REFUNDABLE — so every contribution is tracked per-sender and this module plans
// the refund. Framed as participation, never an investment promise.
//
// This is the pure seam: totals, per-contributor grouping, and the refund plan.
// The on-chain detection (lib/solana.getRecentContributions), the DB ledger
// (lib/prelaunch) and the gated refund execution consume these.
// ─────────────────────────────────────────────────────────────────────────────

/** Dust floor: a contribution below this is ignored (rent/fee noise, not a vote). */
export const MIN_CONTRIBUTION_SOL = 0.001;

export interface Contribution {
  contributorWallet: string;
  amountSol: number;
  txSig: string;
  /** confirmed | refunded */
  status: string;
}

export interface Refund {
  to: string;
  sol: number;
}

// Round to lamport precision (1 SOL = 1e9 lamports) to avoid float drift.
function round9(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

/** A contribution worth recording — a real, positive, above-dust SOL amount. */
export function isMeaningfulContribution(sol: unknown): boolean {
  return typeof sol === "number" && Number.isFinite(sol) && sol >= MIN_CONTRIBUTION_SOL;
}

/** Total SOL still backing the project (confirmed, not yet refunded). */
export function totalRaised(cs: Contribution[]): number {
  return round9(
    cs.filter((c) => c.status === "confirmed").reduce((s, c) => s + (c.amountSol > 0 ? c.amountSol : 0), 0),
  );
}

/** Distinct backers still in (confirmed contributors). */
export function backerCount(cs: Contribution[]): number {
  return new Set(cs.filter((c) => c.status === "confirmed").map((c) => c.contributorWallet)).size;
}

/**
 * Plan the refund: one transfer per distinct backer, summing all their confirmed
 * contributions. Skips anything already refunded and dust-summed entries. The
 * executor moves real SOL from the project's Privy wallet back to each `to`.
 */
export function planRefunds(cs: Contribution[]): Refund[] {
  const byWallet = new Map<string, number>();
  for (const c of cs) {
    if (c.status !== "confirmed" || !(c.amountSol > 0)) continue;
    byWallet.set(c.contributorWallet, round9((byWallet.get(c.contributorWallet) ?? 0) + c.amountSol));
  }
  return Array.from(byWallet.entries())
    .map(([to, sol]) => ({ to, sol: round9(sol) }))
    .filter((r) => r.sol >= MIN_CONTRIBUTION_SOL);
}
