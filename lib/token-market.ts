import "server-only";

import type { Candle, Holder, Project, Trade } from "./types";
import {
  getMarketStats,
  getCandles,
  getRecentTrades,
  type MarketStats,
} from "./market";
import { getTopHoldersCached, getHolderCountCached, getTokenSupplyUiCached, getSolBalanceCached } from "./solana";
import { compactUsd, compactNum } from "./format";

// Server-side aggregator for a launched token's live market. Combines the
// off-chain market feeds (lib/market.ts: DexScreener + GeckoTerminal) with the
// on-chain reads (lib/solana.ts: holders + supply) behind the same data seam,
// and folds the live numbers back onto the Project so every component renders
// real values. Best-effort throughout: a failed piece leaves the snapshot.

// Pump.fun graduates to a DEX at ~$69K market cap; curve progress is the mcap
// fraction toward that threshold (1 once a DEX pair exists / mcap ≥ threshold).
const GRADUATION_MCAP_USD = 69_000;

export interface TokenView {
  /** Project with live market fields folded in (price/mcap/liquidity/…). */
  project: Project;
  stats: MarketStats | null;
  candles: Candle[];
  trades: Trade[];
  holders: Holder[];
  /** Live on-chain SOL balance of the agent wallet, or null if unknown. */
  agentSol: number | null;
}

/** Everything the token page needs for a launched mint, at timeframe `tf`. */
export async function getTokenView(project: Project, tf = "1H"): Promise<TokenView> {
  const mint = project.mint;
  const net = project.network ?? "mainnet";
  if (!mint) {
    return { project, stats: null, candles: [], trades: [], holders: [], agentSol: null };
  }

  const stats = await getMarketStats(mint);
  const [candles, trades, holders, holderCount, supply, agentSol] = await Promise.all([
    stats ? getCandles(stats.pairAddress, tf) : Promise.resolve<Candle[]>([]),
    stats ? getRecentTrades(stats.pairAddress, 10, mint) : Promise.resolve<Trade[]>([]),
    getTopHoldersCached(mint, net),
    getHolderCountCached(mint, net),
    getTokenSupplyUiCached(mint, net),
    project.agentWallet ? getSolBalanceCached(project.agentWallet, net) : Promise.resolve(null),
  ]);

  // Attach .sol names + Loop profile identity to the top holders (two batched
  // lookups) so the holder list shows human names, avatars, and links to Loop
  // profiles; unnamed wallets stay as short addresses.
  const named = holders.length ? await withLoopProfiles(await withSnsNames(holders)) : holders;

  return {
    project: applyLiveMarket(project, stats, holderCount, supply),
    stats,
    candles,
    trades,
    holders: named,
    agentSol,
  };
}

/** Resolve and attach .sol names to a holder list (best-effort, never throws). */
async function withSnsNames(holders: Holder[]): Promise<Holder[]> {
  try {
    const { resolveSnsNames } = await import("./sns");
    const names = await resolveSnsNames(holders.map((h) => h.address));
    return holders.map((h) => ({ ...h, name: names.get(h.address) ?? null }));
  } catch {
    return holders;
  }
}

/** Attach Loop profile identity (display name + avatar) to holders that have a
 *  configured profile — one batched query. Best-effort; never throws. */
async function withLoopProfiles(holders: Holder[]): Promise<Holder[]> {
  try {
    const { supabaseAdmin } = await import("./supabase");
    const sb = supabaseAdmin;
    if (!sb) return holders;
    const { data } = await sb
      .from("profiles")
      .select("wallet,display_name,avatar_url")
      .in("wallet", holders.map((h) => h.address));
    const byWallet = new Map(
      ((data ?? []) as { wallet: string; display_name: string | null; avatar_url: string | null }[]).map((p) => [p.wallet, p])
    );
    return holders.map((h) => {
      const p = byWallet.get(h.address);
      return p ? { ...h, loopName: p.display_name, loopAvatar: p.avatar_url } : h;
    });
  } catch {
    return holders;
  }
}

/**
 * Enrich a project list with live market stats (price/mcap/liquidity/volume/
 * curve) for any project that has a mint. Light — DexScreener only, one fetch
 * per launched project, in parallel; no on-chain holder/supply reads. Used by
 * the landing so cards show real numbers. Best-effort: a failure keeps the row.
 */
export async function withLiveMarket(projects: Project[]): Promise<Project[]> {
  return Promise.all(
    projects.map(async (p) => {
      if (!p.mint) return p;
      const stats = await getMarketStats(p.mint);
      return stats ? applyLiveMarket(p, stats, null, null) : p;
    })
  );
}

/** Fold live numbers onto the Project; missing pieces keep the snapshot. */
function applyLiveMarket(
  p: Project,
  stats: MarketStats | null,
  holderCount: { count: number; capped: boolean } | null,
  supply: number | null
): Project {
  const next: Project = { ...p };
  if (stats) {
    next.price = stats.priceUsd;
    next.marketCap = compactUsd(stats.marketCap);
    next.liquidity = compactUsd(stats.liquidityUsd);
    next.volume24h = compactUsd(stats.volume24hUsd);
    next.curve =
      stats.marketCap >= GRADUATION_MCAP_USD
        ? 1
        : Math.max(0, Math.min(1, stats.marketCap / GRADUATION_MCAP_USD));
  }
  if (holderCount) {
    next.holders = compactNum(holderCount.count) + (holderCount.capped ? "+" : "");
  }
  if (supply) next.supply = compactNum(supply);
  return next;
}
