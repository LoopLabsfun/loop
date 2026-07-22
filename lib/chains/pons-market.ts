import "server-only";

// Live market for a PONS token, read from its Uniswap V3 pool.
//
// The Hood read path was written for OUR HoodLauncher's bonding curve. Pons
// doesn't have one: `launchToken` opens a v3 pool and locks the LP, so the
// token trades on that pool from block one and never appears in
// `launcher.curves(address)`. This is the replacement reader.
//
// The pool address is DERIVED (factory.getPool(token, WETH, fee)) rather than
// stored: it's a pure function of the launch config, so there's no row to keep
// in sync and it works for a token launched before this code existed.

import { PONS_DEX_ID, PONS_FACTORY, PONS_PAIR_TOKEN, PONS_SELECTORS } from "./pons";
import { isTokenZero, priceFromSqrtX96, V3_SELECTORS } from "./pons-pool";

const RPC = process.env.HOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";

/** Uniswap V3 factory + fee tier for Pons launch config 0, read on-chain
 *  2026-07-22 (dex 0 = "uniswap v3", poolFee 10000, tickSpacing 200). */
export const PONS_V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
export const PONS_POOL_FEE = 10000;
/** Total supply minted by launch config 0: 1e27 base units = 1B × 18dp. */
export const PONS_SUPPLY = 1_000_000_000;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function ethCall(to: string, data: string): Promise<string | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [{ to, data }, "latest"],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const out = json?.result;
    return typeof out === "string" && /^0x[0-9a-fA-F]*$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

const addrArg = (a: string) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const uintArg = (n: number) => n.toString(16).padStart(64, "0");
const addrFromWord = (w: string) => "0x" + w.slice(-40);

/**
 * The Uniswap V3 pool a Pons token trades in, or null when it doesn't exist
 * (wrong token, launch not mined yet, RPC down).
 */
export async function getPonsPool(token: string): Promise<string | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) return null;
  const data =
    "0x" +
    V3_SELECTORS.getPool +
    addrArg(token) +
    addrArg(PONS_PAIR_TOKEN) +
    uintArg(PONS_POOL_FEE);
  const out = await ethCall(PONS_V3_FACTORY, data);
  if (!out || out.length < 66) return null;
  const pool = addrFromWord(out.slice(2, 66));
  return pool === ZERO_ADDRESS ? null : pool;
}

export interface PonsMarket {
  pool: string;
  /** Price of one token in ETH. */
  priceEth: number;
  /** Fully-diluted market cap in ETH (fixed 1B supply). */
  marketCapEth: number;
  /** ETH sitting in the pool — the token's actual backing. */
  liquidityEth: number;
  /** Progress toward Pons' graduation threshold, 0..1 (null when unreadable). */
  progress: number | null;
  graduated: boolean;
  /** True when the launched token sorts first in the pool (price orientation). */
  isToken0: boolean;
}

/**
 * Read a Pons token's live market. Null when the pool doesn't exist yet or the
 * chain is unreachable — callers keep whatever snapshot they had, same posture
 * as the Solana path.
 */
export async function getPonsMarket(token: string): Promise<PonsMarket | null> {
  const pool = await getPonsPool(token);
  if (!pool) return null;

  const isToken0 = isTokenZero(token, PONS_PAIR_TOKEN);
  const [slot0, wethBal, grad] = await Promise.all([
    ethCall(pool, "0x" + V3_SELECTORS.slot0),
    // ETH side of the pool. A just-launched Pons position is single-sided (all
    // token, no ETH), so this legitimately starts near zero and grows with buys.
    ethCall(PONS_PAIR_TOKEN, "0x" + V3_SELECTORS.balanceOf + addrArg(pool)),
    ethCall(PONS_FACTORY, "0x" + V3_SELECTORS.graduationStatus + addrArg(token)),
  ]);

  if (!slot0 || slot0.length < 66) return null;
  let sqrtPriceX96: bigint;
  try {
    sqrtPriceX96 = BigInt("0x" + slot0.slice(2, 66));
  } catch {
    return null;
  }
  const priceEth = priceFromSqrtX96(sqrtPriceX96, { isToken0 });

  let liquidityEth = 0;
  if (wethBal && wethBal.length >= 66) {
    try {
      liquidityEth = Number(BigInt(wethBal)) / 1e18;
    } catch {
      /* keep 0 */
    }
  }

  // graduationStatus(address) → (raised, threshold, graduated)
  let progress: number | null = null;
  let graduated = false;
  if (grad && grad.length >= 2 + 64 * 3) {
    try {
      const raised = Number(BigInt("0x" + grad.slice(2, 66)));
      const threshold = Number(BigInt("0x" + grad.slice(66, 130)));
      graduated = BigInt("0x" + grad.slice(130, 194)) !== BigInt(0);
      if (threshold > 0) progress = Math.min(1, raised / threshold);
    } catch {
      /* leave null */
    }
  }

  return {
    pool,
    priceEth,
    marketCapEth: priceEth * PONS_SUPPLY,
    liquidityEth,
    progress,
    graduated,
    isToken0,
  };
}

/** Cheap memo so a page render doesn't re-read the same pool several times. */
const cache = new Map<string, { at: number; value: PonsMarket | null }>();
const TTL_MS = 20_000;

export async function getPonsMarketCached(token: string): Promise<PonsMarket | null> {
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await getPonsMarket(token);
  cache.set(token, { at: Date.now(), value });
  return value;
}

/** Which launchpad a Hood project came from, so the market reader picks the
 *  right source. Pons tokens have no launcher curve; HoodLauncher tokens do. */
export function isPonsLaunchpad(launchpad: string | null | undefined): boolean {
  return (launchpad ?? "").toLowerCase() === "pons";
}

export { PONS_DEX_ID };
