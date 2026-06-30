// ─────────────────────────────────────────────────────────────────────────────
// FEE DISTRIBUTION — turn the accounting split into REAL on-chain transfers.
//
// lib/fee-ledger.ts tracks who EARNED what (founder/agent/platform) after each
// creator-fee sweep. This module plans the physical disbursement of the AGENT and
// PLATFORM (and, when needed, FOUNDER) shares out of the custodial creator
// wallet (which received the swept fees) into their own wallets, so the 30/65/5
// split is real money movement, not just a number on a page.
//
// A share is only transferred when its destination differs from the SOURCE
// wallet (the wallet the fees were claimed into). When they're the same the
// share already sits where it belongs and is left in place — so for LOOP, where
// the creator wallet IS the founder/treasury wallet, the founder share never
// moves, while for a project launched from a SHARED signer (creator ≠ founder),
// the founder share IS transferred out to that project's founder wallet.
//
// Pure (no I/O): given the claimable amounts + destination wallets, it returns the
// exact transfers to make (skipping dust / missing wallets), so the execution
// script stays a thin, well-guarded wrapper and the math is fully unit-tested.
// Real SOL only ever moves behind the script's explicit --execute flag.
// ─────────────────────────────────────────────────────────────────────────────

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Default dust floor — never build a transfer below this (gas would dominate). */
export const MIN_TRANSFER_SOL = 0.001;

export type DistributeRole = "founder" | "agent" | "platform";

export interface FeeTransfer {
  role: DistributeRole;
  /** Destination wallet (validated base58). */
  to: string;
  /** SOL to send. */
  sol: number;
}

export interface DistributionPlan {
  /** The transfers to broadcast, in order (agent, then platform). */
  transfers: FeeTransfer[];
  /** Total SOL that would move. */
  totalSol: number;
  /** Human reasons a share was NOT included (dust, missing/invalid wallet). */
  skipped: string[];
}

function round9(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

/**
 * Plan the agent + platform disbursements from their claimable balances. Skips a
 * share when its wallet is missing/invalid or the amount is below the dust floor;
 * the reason is recorded so the caller can surface it. Pure.
 */
export function planFeeDistribution(args: {
  /** Agent share not yet disbursed (earned − claimed). */
  claimableAgentSol: number;
  /** Platform share not yet disbursed. */
  claimablePlatformSol: number;
  /** Founder share not yet disbursed. Omitted/0 ⇒ no founder leg (legacy LOOP
   *  callers don't pass it; the founder share simply stays in the source wallet). */
  claimableFounderSol?: number;
  /** Agent wallet (project.agent_wallet); null/invalid ⇒ skipped. */
  agentWallet: string | null | undefined;
  /** Platform wallet (PLATFORM_WALLET env); null/invalid ⇒ skipped. */
  platformWallet: string | null | undefined;
  /** Founder wallet (project.creator_wallet); null/invalid ⇒ skipped. */
  founderWallet?: string | null | undefined;
  /** The wallet the fees were claimed into. A share whose destination equals it
   *  is left in place (already where it belongs) rather than transferred. When
   *  omitted, no share is treated as "in place" (legacy behaviour). */
  sourceWallet?: string | null | undefined;
  /** Dust floor; defaults to MIN_TRANSFER_SOL. */
  minTransferSol?: number;
}): DistributionPlan {
  const min = args.minTransferSol ?? MIN_TRANSFER_SOL;
  const transfers: FeeTransfer[] = [];
  const skipped: string[] = [];

  const consider = (
    role: DistributeRole,
    amount: number,
    wallet: string | null | undefined
  ) => {
    const sol = round9(Math.max(0, amount));
    if (sol < min) {
      if (sol > 0) skipped.push(`${role}: ${sol} SOL below dust floor (${min})`);
      return;
    }
    if (!wallet || !BASE58.test(wallet)) {
      skipped.push(`${role}: no valid wallet configured (${sol} SOL held)`);
      return;
    }
    // Destination == source ⇒ already where it belongs; never move it.
    if (args.sourceWallet && wallet === args.sourceWallet) {
      skipped.push(`${role}: destination is the source wallet (${sol} SOL stays in place)`);
      return;
    }
    transfers.push({ role, to: wallet, sol });
  };

  consider("founder", args.claimableFounderSol ?? 0, args.founderWallet);
  consider("agent", args.claimableAgentSol, args.agentWallet);
  consider("platform", args.claimablePlatformSol, args.platformWallet);

  const totalSol = round9(transfers.reduce((s, t) => s + t.sol, 0));
  return { transfers, totalSol, skipped };
}
