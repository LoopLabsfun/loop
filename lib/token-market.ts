import "server-only";

import type { Candle, Holder, Project, Trade } from "./types";
import {
  getMarketStats,
  getCandles,
  getRecentTrades,
  resolveTradingPool,
  type MarketStats,
} from "./market";
import { getTopHoldersCached, getHolderCountCached, getTokenSupplyUiCached, getSolBalanceCached } from "./solana";
import { getEthBalanceCached } from "./chains/hood";
import { getHoodTokenMarket } from "./chains/hood-market";
import { isPonsLaunchpad } from "./chains/pons-market";
import { getPonsHistory } from "./chains/pons-history";
import { getEthUsd } from "./price";
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

  // Hood (Robinhood Chain) tokens: market comes from the bonding curve or the
  // Pons v3 pool, not DexScreener. For a Pons token the pool's Swap logs give
  // the same candles + trades the Solana path gets from GeckoTerminal (see
  // pons-history.ts); holders still need indexing, so those stay empty. The
  // agent balance is native ETH.
  if (project.chain === "hood") {
    const ethUsd = await getEthUsd();
    const isPons = isPonsLaunchpad(project.launchpad);
    const [{ project: withMarket, stats }, history, agentEth] = await Promise.all([
      getHoodTokenMarket(project, ethUsd),
      mint && isPons ? getPonsHistory(mint, ethUsd, tf) : Promise.resolve({ candles: [], trades: [] }),
      project.agentWallet ? getEthBalanceCached(project.agentWallet) : Promise.resolve(null),
    ]);
    return {
      project: withMarket,
      stats,
      candles: history.candles,
      trades: history.trades,
      holders: [],
      agentSol: agentEth,
    };
  }

  const stats = await getMarketStats(mint);
  // Chart the deepest live pool — stats.pairAddress can be the dead bonding
  // curve on a graduated token (see resolveTradingPool in lib/market.ts).
  const pool = stats ? await resolveTradingPool(mint, stats.pairAddress) : null;
  const [candles, trades, holders, holderCount, supply, agentSol] = await Promise.all([
    pool ? getCandles(pool, tf) : Promise.resolve<Candle[]>([]),
    pool ? getRecentTrades(pool, 10, mint) : Promise.resolve<Trade[]>([]),
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
  // ETH/USD is fetched once (cached) only when a Hood project is present, so the
  // all-Solana path keeps zero extra calls.
  const hasHood = projects.some((p) => p.chain === "hood" && p.mint);
  const ethUsd = hasHood ? await getEthUsd() : 0;
  return Promise.all(
    projects.map(async (p) => {
      if (!p.mint) return p;
      if (p.chain === "hood") {
        const { project } = await getHoodTokenMarket(p, ethUsd);
        return project;
      }
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
