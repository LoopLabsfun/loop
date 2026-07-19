import "server-only";

// Hood (Robinhood Chain) fee distribution — the ETH counterpart of
// lib/fee-distribute.ts. The HoodLauncher accrues ALL fees (creation + 1% trade
// + 5% migration) into ONE treasury (the platform's) via withdrawFees(). This
// module splits a claimable ETH amount into the founder / agent / platform legs
// (platform ALWAYS 5%, founder % set at launch — same makeSplit as Solana) and
// plans the physical ETH transfers out of the platform wallet.
//
// The split MATH + the PLAN are pure and unit-tested; execution is a thin,
// env-gated wrapper that moves real ETH via the platform's Privy-custodied
// wallet (lib/chains/hood-agent-wallet.privySendEvmTx). See docs/multichain-hood.md.

import { makeSplit } from "../fees";
import { privySendEvmTx } from "./hood-agent-wallet";
import { agentWalletConfigured } from "../agent-wallet";

const EVM = /^0x[0-9a-fA-F]{40}$/;

/** Default dust floor — never build a transfer below this (gas would dominate).
 *  0.0001 ETH; cheap on an L2 but still a sane floor. */
export const MIN_TRANSFER_WEI = BigInt("100000000000000");

export type DistributeRole = "founder" | "agent" | "platform";

export interface HoodFeeTransfer {
  role: DistributeRole;
  /** Destination EVM address. */
  to: string;
  /** Wei to send. */
  wei: bigint;
}

export interface HoodDistributionPlan {
  transfers: HoodFeeTransfer[];
  totalWei: bigint;
  /** Human reasons a share was NOT included (dust, missing/invalid wallet, in place). */
  skipped: string[];
}

/**
 * Split a total ETH fee amount (wei) into founder/agent/platform legs. Platform
 * is fixed at 5% (makeSplit); founder is the launch-defined share; agent gets
 * the rest. Platform absorbs any rounding remainder, so the three always sum to
 * exactly `totalWei` (never over-distribute). Pure.
 */
export function splitFeesWei(
  totalWei: bigint,
  founderPct: number | null | undefined
): { founderWei: bigint; agentWei: bigint; platformWei: bigint } {
  const s = makeSplit(founderPct ?? 0);
  const founderWei = (totalWei * BigInt(s.founderPct)) / BigInt(100);
  const agentWei = (totalWei * BigInt(s.agentPct)) / BigInt(100);
  const platformWei = totalWei - founderWei - agentWei; // remainder → platform
  return { founderWei, agentWei, platformWei };
}

/**
 * Plan the founder + agent + platform ETH disbursements from their claimable
 * balances. Skips a share when its wallet is missing/invalid, the amount is
 * below the dust floor, or its destination equals the source wallet (already
 * where it belongs). Pure — mirrors planFeeDistribution for wei/EVM.
 */
export function planHoodFeeDistribution(args: {
  claimableFounderWei?: bigint;
  claimableAgentWei: bigint;
  claimablePlatformWei: bigint;
  founderWallet?: string | null;
  agentWallet?: string | null;
  platformWallet?: string | null;
  /** The wallet the fees were withdrawn into; a share whose destination equals
   *  it stays in place (not transferred). */
  sourceWallet?: string | null;
  minTransferWei?: bigint;
}): HoodDistributionPlan {
  const min = args.minTransferWei ?? MIN_TRANSFER_WEI;
  const transfers: HoodFeeTransfer[] = [];
  const skipped: string[] = [];

  const consider = (role: DistributeRole, amount: bigint, wallet: string | null | undefined) => {
    const wei = amount > BigInt(0) ? amount : BigInt(0);
    if (wei < min) {
      if (wei > BigInt(0)) skipped.push(`${role}: ${wei} wei below dust floor (${min})`);
      return;
    }
    if (!wallet || !EVM.test(wallet)) {
      skipped.push(`${role}: no valid wallet configured (${wei} wei held)`);
      return;
    }
    if (args.sourceWallet && wallet.toLowerCase() === args.sourceWallet.toLowerCase()) {
      skipped.push(`${role}: destination is the source wallet (${wei} wei stays in place)`);
      return;
    }
    transfers.push({ role, to: wallet, wei });
  };

  consider("founder", args.claimableFounderWei ?? BigInt(0), args.founderWallet);
  consider("agent", args.claimableAgentWei, args.agentWallet);
  consider("platform", args.claimablePlatformWei, args.platformWallet);

  const totalWei = transfers.reduce((s, t) => s + t.wei, BigInt(0));
  return { transfers, totalWei, skipped };
}

export interface HoodDistributeResult {
  ok: boolean;
  /** Sent transfers with their tx hashes. */
  sent: { role: DistributeRole; to: string; wei: string; hash: string }[];
  skipped: string[];
  note: string;
}

/**
 * Execute a Hood distribution plan by sending each transfer from the platform's
 * Privy-custodied wallet (`sourceWalletId`). Env-gated + dormant: with
 * `armed:false` (default) it's a dry run that returns the plan without moving
 * ETH — real money only moves when the caller explicitly arms it AND Privy
 * custody is configured. Best-effort per transfer; a failed leg is recorded and
 * the rest continue.
 */
export async function executeHoodFeeDistribution(
  sourceWalletId: string,
  plan: HoodDistributionPlan,
  opts: { armed?: boolean } = {}
): Promise<HoodDistributeResult> {
  const sent: HoodDistributeResult["sent"] = [];
  if (!plan.transfers.length) {
    return { ok: true, sent, skipped: plan.skipped, note: "nothing to distribute" };
  }
  if (!opts.armed) {
    return {
      ok: true,
      sent,
      skipped: plan.skipped,
      note: `dry run — ${plan.transfers.length} transfer(s), ${plan.totalWei} wei (pass armed:true to send)`,
    };
  }
  if (!agentWalletConfigured()) {
    return { ok: false, sent, skipped: plan.skipped, note: "Privy custody not configured" };
  }

  const errors: string[] = [];
  for (const t of plan.transfers) {
    try {
      const hash = await privySendEvmTx(sourceWalletId, { to: t.to, valueWei: t.wei });
      sent.push({ role: t.role, to: t.to, wei: t.wei.toString(), hash });
    } catch (e) {
      errors.push(`${t.role}: ${e instanceof Error ? e.message : "send failed"}`);
    }
  }
  return {
    ok: errors.length === 0,
    sent,
    skipped: [...plan.skipped, ...errors],
    note: `sent ${sent.length}/${plan.transfers.length} transfer(s)`,
  };
}
