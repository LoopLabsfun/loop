// ─────────────────────────────────────────────────────────────────────────────
// PONS MARKET — pure math + log decoding for a Pons token's Uniswap V3 pool.
//
// Pons does NOT run a bonding curve. `launchToken` creates a Uniswap V3 pool,
// mints the whole supply into one position and locks it — so from block one the
// token trades on a v3 pool, not on a launcher curve. Everything the Hood side
// reads today (`getCurveState`, `hood-market`, the buybot) goes through OUR
// HoodLauncher's `curves(address)`, which a Pons token will never appear in.
// Left as-is, a Pons launch renders a $0 market and a silent buybot.
//
// The pool address never needs storing: it is derivable from the factory, the
// token, the pair token and the fee tier, all of which are fixed per launch
// config. One eth_call, no log archaeology, works at any point in time.
//
// Pure and dependency-free — the I/O lives in pons-market.ts, so the price math
// (the part that is easy to get subtly wrong) is unit-testable on its own.
// ─────────────────────────────────────────────────────────────────────────────

/** Uniswap V3 `Swap(address,address,int256,int256,uint160,uint128,int24)`. */
export const V3_SWAP_TOPIC0 =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

export const V3_SELECTORS = {
  /** IUniswapV3Factory.getPool(address,address,uint24) */
  getPool: "1698ee82",
  /** IUniswapV3Pool.slot0() */
  slot0: "3850c7bd",
  /** ERC20.balanceOf(address) */
  balanceOf: "70a08231",
  /** PonsLaunchFactory.graduationStatus(address) */
  graduationStatus: "98d652f1",
} as const;

export const V3_SIGNATURES = {
  getPool: "getPool(address,address,uint24)",
  slot0: "slot0()",
  balanceOf: "balanceOf(address)",
  graduationStatus: "graduationStatus(address)",
  swapEvent: "Swap(address,address,int256,int256,uint160,uint128,int24)",
} as const;

const TWO_POW_96 = 2 ** 96;

/** A 32-byte word from a hex blob (0x-prefixed or not), by index. */
export function wordAt(hex: string, i: number): string {
  const h = (hex || "").replace(/^0x/, "");
  return h.slice(i * 64, (i + 1) * 64);
}

/** Read a signed 256-bit two's-complement word as a bigint. */
export function toInt256(word: string): bigint {
  if (!/^[0-9a-fA-F]{64}$/.test(word)) return BigInt(0);
  const v = BigInt("0x" + word);
  const LIMIT = BigInt(1) << BigInt(255);
  return v >= LIMIT ? v - (BigInt(1) << BigInt(256)) : v;
}

/**
 * Price of the launched token in the pair token (ETH), from the pool's
 * sqrtPriceX96.
 *
 * v3 stores sqrt(token1/token0) × 2^96, so the ordering matters: Pons sorts by
 * address, and getting `isToken0` backwards inverts the price — a token worth
 * 0.000001 ETH would display as 1,000,000 ETH. That's the whole reason this is a
 * tested pure function rather than three lines inline.
 *
 * Both sides are 18-decimal here (the Pons ERC-20 and WETH), so no decimal
 * correction is needed; the parameters are explicit anyway so a future non-18
 * pair token doesn't silently break it.
 */
export function priceFromSqrtX96(
  sqrtPriceX96: bigint,
  opts: { isToken0: boolean; tokenDecimals?: number; pairDecimals?: number } = { isToken0: true }
): number {
  if (sqrtPriceX96 <= BigInt(0)) return 0;
  // Number() loses sub-53-bit precision on a ~2^96 value; that's ~1e-16
  // relative, far below anything a price display can show.
  const s = Number(sqrtPriceX96) / TWO_POW_96;
  const ratio = s * s; // token1 per token0, in raw units
  const tokenDec = opts.tokenDecimals ?? 18;
  const pairDec = opts.pairDecimals ?? 18;
  // raw ratio → human ratio: multiply by 10^(dec0 - dec1)
  const [dec0, dec1] = opts.isToken0 ? [tokenDec, pairDec] : [pairDec, tokenDec];
  const scaled = ratio * 10 ** (dec0 - dec1);
  if (!Number.isFinite(scaled) || scaled <= 0) return 0;
  // isToken0 ⇒ ratio is already pair-per-token; otherwise invert.
  return opts.isToken0 ? scaled : 1 / scaled;
}

/** Pons sorts the pool's tokens by address, like every v3 pool. */
export function isTokenZero(token: string, pairToken: string): boolean {
  return token.toLowerCase() < pairToken.toLowerCase();
}

export interface V3Swap {
  /** True when the pool RECEIVED pair token and sent the launched token out —
   *  i.e. somebody bought. */
  isBuy: boolean;
  /** Pair token (ETH) that moved, absolute value in wei. */
  ethWei: bigint;
  /** Launched token that moved, absolute value in base units. */
  tokenWei: bigint;
  recipient: string | null;
  txHash: string | null;
  blockNumber: number | null;
}

export interface RawLog {
  topics?: string[];
  data?: string;
  transactionHash?: string | null;
  blockNumber?: string | null;
}

/**
 * Decode a v3 Swap log into buy/sell + amounts.
 *
 * v3 signs the amounts from the POOL's perspective: negative means the pool
 * paid it out. So a buy is "the pool received pair token", which is
 * `amount<pair> > 0`. Reading it from the trader's side instead flips every
 * alert — the bot would announce sells as buys.
 */
export function decodeV3Swap(log: RawLog, opts: { isToken0: boolean }): V3Swap | null {
  if (!log?.topics?.length || log.topics[0]?.toLowerCase() !== V3_SWAP_TOPIC0) return null;
  const data = log.data || "";
  // A v3 Swap's data is exactly 5 words: amount0, amount1, sqrtPriceX96,
  // liquidity, tick. (sender + recipient are indexed → topics, not data.)
  if (data.replace(/^0x/, "").length < 64 * 5) return null;
  try {
    const amount0 = toInt256(wordAt(data, 0));
    const amount1 = toInt256(wordAt(data, 1));
    const tokenAmt = opts.isToken0 ? amount0 : amount1;
    const pairAmt = opts.isToken0 ? amount1 : amount0;
    const abs = (v: bigint) => (v < BigInt(0) ? -v : v);
    return {
      isBuy: pairAmt > BigInt(0),
      ethWei: abs(pairAmt),
      tokenWei: abs(tokenAmt),
      recipient: log.topics[2] ? "0x" + log.topics[2].slice(-40) : null,
      txHash: log.transactionHash ?? null,
      blockNumber: log.blockNumber ? Number(BigInt(log.blockNumber)) : null,
    };
  } catch {
    return null;
  }
}
