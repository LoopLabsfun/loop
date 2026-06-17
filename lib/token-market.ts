import "server-only";

import type { Candle, Holder, Project, Trade } from "./types";
import {
  getMarketStats,
  getCandles,
  getRecentTrades,
  type MarketStats,
} from "./market";
import { getTopHolders, getHolderCount, getTokenSupplyUi } from "./solana";
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
}

/** Everything the token page needs for a launched mint, at timeframe `tf`. */
export async function getTokenView(project: Project, tf = "1D"): Promise<TokenView> {
  const mint = project.mint;
  const net = project.network ?? "mainnet";
  if (!mint) {
    return { project, stats: null, candles: [], trades: [], holders: [] };
  }

  const stats = await getMarketStats(mint);
  const [candles, trades, holders, holderCount, supply] = await Promise.all([
    stats ? getCandles(stats.pairAddress, tf) : Promise.resolve<Candle[]>([]),
    stats ? getRecentTrades(stats.pairAddress) : Promise.resolve<Trade[]>([]),
    getTopHolders(mint, net),
    getHolderCount(mint, net),
    getTokenSupplyUi(mint, net),
  ]);

  return {
    project: applyLiveMarket(project, stats, holderCount, supply),
    stats,
    candles,
    trades,
    holders,
  };
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
