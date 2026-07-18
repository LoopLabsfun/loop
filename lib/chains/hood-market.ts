import "server-only";

import { compactUsd } from "../format";
import type { MarketStats } from "../market";
import type { Project } from "../types";
import { getCurveStateCached, type CurveState } from "./hood";

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

/** Read a Hood token's curve and return the market stats + the project with live
 *  numbers folded in. Returns the untouched project + null stats when the token
 *  has no readable curve (launcher not deployed, unknown token, RPC failure). */
export async function getHoodTokenMarket(
  project: Project,
  ethUsd: number
): Promise<{ project: Project; stats: MarketStats | null }> {
  const token = project.mint;
  if (!token) return { project, stats: null };
  const curve = await getCurveStateCached(token);
  if (!curve) return { project, stats: null };
  return {
    project: applyHoodMarket(project, curve, ethUsd),
    stats: curveToMarketStats(curve, token, ethUsd),
  };
}
