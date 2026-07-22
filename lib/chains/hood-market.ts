import "server-only";

import { compactUsd } from "../format";
import type { MarketStats } from "../market";
import type { Project } from "../types";
import { getCurveStateCached, type CurveState } from "./hood";
import { getPonsMarketCached, isPonsLaunchpad, type PonsMarket } from "./pons-market";

// Hood (Robinhood Chain) market seam — the EVM counterpart of lib/token-market's
// DexScreener path. Pre-migration, all market data comes from the HoodLauncher
// bonding curve (getCurveState); post-migration the token trades on Uniswap v2
// (reading the pair reserves is a later step — docs/multichain-hood.md). Both
// paths are best-effort: a null curve leaves the project's snapshot untouched.

const WEI = 1e18;

/** Build MarketStats from a token's live curve state + ETH/USD, or null when the
 *  launcher/token isn't readable. Denominated in USD like the Solana path, with
 *  `priceNative` carrying the ETH price. */
export function curveToMarketStats(curve: CurveState, token: string, ethUsd: number): MarketStats {
  const priceUsd = curve.priceEth * ethUsd;
  return {
    priceUsd,
    priceNative: curve.priceEth,
    marketCap: curve.marketCapEth * ethUsd,
    // ETH collected in the curve so far (its backing) as a liquidity proxy.
    liquidityUsd: (Number(curve.realEth) / WEI) * ethUsd,
    // Trade-event indexing (Blockscout eth_getLogs) is a later step.
    volume24hUsd: 0,
    priceChange24h: 0,
    // No AMM pair pre-migration; the token address is the stable identifier.
    pairAddress: token,
    graduated: curve.migrated,
  };
}

/** Fold live curve numbers onto a Hood project (price/mcap/liquidity/curve).
 *  The curve `progress` is the REAL migration fraction (realEth/target), more
 *  accurate than the Solana $-threshold heuristic. Missing pieces keep the snapshot. */
export function applyHoodMarket(p: Project, curve: CurveState, ethUsd: number): Project {
  const next: Project = { ...p };
  next.price = curve.priceEth * ethUsd;
  next.marketCap = compactUsd(curve.marketCapEth * ethUsd);
  next.liquidity = compactUsd((Number(curve.realEth) / WEI) * ethUsd);
  next.curve = curve.progress;
  return next;
}

/** Build MarketStats from a PONS token's Uniswap V3 pool. Pons has no bonding
 *  curve — the pool IS the market from block one — so this is the counterpart of
 *  curveToMarketStats for tokens launched there. */
export function ponsToMarketStats(m: PonsMarket, ethUsd: number): MarketStats {
  return {
    priceUsd: m.priceEth * ethUsd,
    priceNative: m.priceEth,
    marketCap: m.marketCapEth * ethUsd,
    // The ETH actually sitting in the pool — the token's real backing.
    liquidityUsd: m.liquidityEth * ethUsd,
    // Trade-event indexing for 24h volume is a later step (the buybot already
    // reads the pool's Swap logs; aggregating them here is the same source).
    volume24hUsd: 0,
    priceChange24h: 0,
    // The pool address is the stable pair identifier, like the Solana pair.
    pairAddress: m.pool,
    graduated: m.graduated,
  };
}

/** Fold a Pons pool's live numbers onto the project. */
export function applyPonsMarket(p: Project, m: PonsMarket, ethUsd: number): Project {
  const next: Project = { ...p };
  next.price = m.priceEth * ethUsd;
  next.marketCap = compactUsd(m.marketCapEth * ethUsd);
  next.liquidity = compactUsd(m.liquidityEth * ethUsd);
  if (m.progress !== null) next.curve = m.progress;
  return next;
}

/**
 * Read a Hood token's live market.
 *
 * TWO sources, chosen by the project's launchpad: a PONS token trades in a
 * Uniswap V3 pool and never appears in our launcher's `curves(address)`, so
 * reading the curve for it returns null forever — a $0 market on a live token.
 * Anything else falls back to the HoodLauncher curve as before.
 *
 * Returns the untouched project + null stats when nothing is readable (token
 * not launched yet, unknown token, RPC failure).
 */
export async function getHoodTokenMarket(
  project: Project,
  ethUsd: number
): Promise<{ project: Project; stats: MarketStats | null }> {
  const token = project.mint;
  if (!token) return { project, stats: null };

  if (isPonsLaunchpad(project.launchpad)) {
    const pons = await getPonsMarketCached(token);
    if (!pons) return { project, stats: null };
    return {
      project: applyPonsMarket(project, pons, ethUsd),
      stats: ponsToMarketStats(pons, ethUsd),
    };
  }

  const curve = await getCurveStateCached(token);
  if (!curve) return { project, stats: null };
  return {
    project: applyHoodMarket(project, curve, ethUsd),
    stats: curveToMarketStats(curve, token, ethUsd),
  };
}
