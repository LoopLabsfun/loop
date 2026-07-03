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

/** Base network fee the fee-paying project wallet must keep to broadcast a refund
 *  (one signature, no priority fee → exactly 5000 lamports). */
export const REFUND_FEE_LAMPORTS = 5_000;

/** Rent-exempt minimum for a system account with no data (~0.00089 SOL). Solana
 *  REJECTS a transfer that would leave the source with a NON-ZERO balance below
 *  this (`InsufficientFundsForRent`) — the leftover must be exactly 0 or ≥ this. */
export const RENT_EXEMPT_MIN_LAMPORTS = 890_880;

/**
 * How many lamports to actually send for one refund. The project wallet pays the
 * network fee out of its OWN balance and typically holds EXACTLY the sum of
 * contributions (nothing seeds it for fees), so two rules bite:
 *   1. it must keep the ~5000-lamport fee, else the transfer has insufficient funds;
 *   2. it can't be left with a non-zero balance BELOW the rent-exempt minimum — the
 *      leftover has to be exactly 0 or ≥ rent-exempt, or the tx fails on rent.
 * So a full drain sends `balance − fee` (leftover 0); a partial refund that would
 * strand sub-rent dust is bumped up to a full drain instead. Returns 0 when the
 * balance can't even cover the fee (skip). A null balance (RPC read failed) falls
 * back to the full owed amount so a transient read never blocks a refund. Pure.
 */
export function refundSendableLamports(
  owedLamports: number,
  availableLamports: number | null,
  fee: number = REFUND_FEE_LAMPORTS,
  rentExemptMin: number = RENT_EXEMPT_MIN_LAMPORTS,
): number {
  const owed = Math.max(0, Math.round(owedLamports));
  if (availableLamports == null) return owed;
  const avail = Math.floor(availableLamports);
  const maxSend = avail - fee; // sending this drains the wallet to exactly 0
  if (maxSend <= 0) return 0; // can't even cover the fee
  if (owed >= maxSend) return maxSend; // full drain → leftover 0
  // owed < maxSend: sending owed would leave (avail − owed − fee). If that's a
  // non-zero sub-rent amount, drain fully instead to avoid the rent rejection.
  const leftover = avail - owed - fee;
  return leftover >= rentExemptMin ? owed : maxSend;
}
