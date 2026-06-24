// ─────────────────────────────────────────────────────────────────────────────
// FEE DISTRIBUTION — turn the accounting split into REAL on-chain transfers.
//
// lib/fee-ledger.ts tracks who EARNED what (founder/agent/platform) after each
// creator-fee sweep. This module plans the physical disbursement of the AGENT and
// PLATFORM shares out of the custodial creator wallet (which received the swept
// fees) into their own wallets, so the 30/65/5 split is real money movement, not
// just a number on a page. The FOUNDER share is deliberately NOT transferred: for
// LOOP the creator wallet IS the founder/treasury wallet, so the founder share is
// already where it belongs; a separate founder project would claim it via a
// withdrawal.
//
// Pure (no I/O): given the claimable amounts + destination wallets, it returns the
// exact transfers to make (skipping dust / missing wallets), so the execution
// script stays a thin, well-guarded wrapper and the math is fully unit-tested.
// Real SOL only ever moves behind the script's explicit --execute flag.
// ─────────────────────────────────────────────────────────────────────────────

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Default dust floor — never build a transfer below this (gas would dominate). */
export const MIN_TRANSFER_SOL = 0.001;

export type DistributeRole = "agent" | "platform";

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
  /** Agent wallet (project.agent_wallet); null/invalid ⇒ skipped. */
  agentWallet: string | null | undefined;
  /** Platform wallet (PLATFORM_WALLET env); null/invalid ⇒ skipped. */
  platformWallet: string | null | undefined;
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
    transfers.push({ role, to: wallet, sol });
  };

  consider("agent", args.claimableAgentSol, args.agentWallet);
  consider("platform", args.claimablePlatformSol, args.platformWallet);

  const totalSol = round9(transfers.reduce((s, t) => s + t.sol, 0));
  return { transfers, totalSol, skipped };
}
