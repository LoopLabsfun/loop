import "server-only";
import { supabaseAdmin } from "./supabase";
import type { Project } from "./types";
import { getFeeLedger } from "./fee-ledger-store";
import { claimable, type RoleTotals } from "./fee-ledger";
import { getSolBalance, getSplBalance, type Network } from "./solana";
import { getAgentWallet } from "./agent-wallet";
import { getComputeLedger } from "./compute-ledger-store";
import { creditBalanceUsd } from "./compute-rail";

// Founder TREASURY DIAGNOSTIC — the read-only view of a project's real money
// state, lifting scripts/diag-treasury.ts into the admin cockpit. Server-only,
// founder-gated at the route. NO money moves: this only READS the chain + the
// fee_ledger + agent_actions so the founder can decide whether to claim/sweep.

export interface OnChainWallet {
  address: string | null;
  sol: number | null;
  token: number | null;
}

export interface ActionAgg {
  key: string; // "kind/disposition"
  count: number;
  sol: number;
}

export interface ComputeDiag {
  creditedUsd: number;
  consumedUsd: number;
  balanceUsd: number;
  /** Is the per-project compute hard-cap (COMPUTE_BUDGET_GATE) actually armed? */
  gateArmed: boolean;
}

export interface TreasuryDiag {
  key: string;
  network: string;
  treasuryWallet: string | null;
  mint: string | null;
  treasurySnapshotSol: number | null;
  ledger: { earned: RoleTotals; claimed: RoleTotals; claimable: RoleTotals };
  actions: ActionAgg[];
  buybackExecutedSol: number;
  buybackTxCount: number;
  treasury: OnChainWallet;
  agent: OnChainWallet;
  compute: ComputeDiag;
}

/** Build the founder treasury diagnostic for one project (read-only). */
export async function getTreasuryDiag(p: Project): Promise<TreasuryDiag> {
  const net: Network = p.network === "mainnet" ? "mainnet" : "devnet";
  const treasuryWallet = p.treasuryWallet ?? null;
  const mint = p.mint ?? null;

  const sb = supabaseAdmin;

  // Fee accounting (pure, DB-backed) — earned / claimed / claimable per role.
  const fl = await getFeeLedger(p.key).catch(() => null);
  const earned = fl?.earned ?? { founderSol: 0, agentSol: 0, platformSol: 0 };
  const claimed = fl?.claimed ?? { founderSol: 0, agentSol: 0, platformSol: 0 };

  // agent_actions aggregated by kind/disposition + executed buyback total.
  const actions: ActionAgg[] = [];
  let buybackExecutedSol = 0;
  let buybackTxCount = 0;
  if (sb) {
    const { data: acts } = await sb
      .from("agent_actions")
      .select("kind,disposition,amount_sol,tx_sig")
      .eq("project_key", p.key)
      .order("created_at", { ascending: false })
      .limit(2000);
    const agg: Record<string, { count: number; sol: number }> = {};
    for (const a of acts ?? []) {
      const k = `${a.kind}/${a.disposition}`;
      agg[k] ??= { count: 0, sol: 0 };
      agg[k].count++;
      agg[k].sol += (a.amount_sol as number) ?? 0;
      if (a.kind === "buyback" && a.disposition === "executed") {
        buybackExecutedSol += (a.amount_sol as number) ?? 0;
        if (a.tx_sig) buybackTxCount++;
      }
    }
    for (const [key, v] of Object.entries(agg)) {
      actions.push({ key, count: v.count, sol: Math.round(v.sol * 1e9) / 1e9 });
    }
    actions.sort((a, b) => b.count - a.count);
  }

  // On-chain balances — best-effort; null reads mean "couldn't read", not zero.
  const readWallet = async (address: string | null): Promise<OnChainWallet> => {
    if (!address) return { address: null, sol: null, token: null };
    const [sol, token] = await Promise.all([
      getSolBalance(address, net).catch(() => null),
      mint ? getSplBalance(address, mint, net).catch(() => null) : Promise.resolve(null),
    ]);
    return { address, sol, token };
  };

  const agentAddr = await getAgentWallet(p.key)
    .then((w) => w?.address ?? null)
    .catch(() => null);

  const [treasury, agent] = await Promise.all([
    readWallet(treasuryWallet),
    readWallet(agentAddr),
  ]);

  // Real Claude $ spend tracking (lib/compute-rail) — the founder's other budget
  // gate, alongside the SOL treasury above. Read-only here; same posture as the
  // rest of this diagnostic.
  const computeLedger = await getComputeLedger(p.key).catch(() => ({ creditedUsd: 0, consumedUsd: 0 }));

  return {
    key: p.key,
    network: net,
    treasuryWallet,
    mint,
    treasurySnapshotSol: p.treasurySol ?? null,
    ledger: { earned, claimed, claimable: claimable(earned, claimed) },
    actions,
    buybackExecutedSol: Math.round(buybackExecutedSol * 1e9) / 1e9,
    buybackTxCount,
    treasury,
    agent,
    compute: {
      creditedUsd: computeLedger.creditedUsd,
      consumedUsd: computeLedger.consumedUsd,
      balanceUsd: creditBalanceUsd(computeLedger),
      gateArmed: process.env.COMPUTE_BUDGET_GATE === "1",
    },
  };
}
