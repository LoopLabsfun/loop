import "server-only";

import type { Candle, MarketStats, Trade } from "./types";

// Live on-chain MARKET data for a launched token, behind the same data seam as
// solana.ts (treasury) and price.ts (SOL/USD). Two free, no-key sources:
//   • DexScreener  — current price / market cap / liquidity / 24h volume + the
//     pump.fun pair address. One call per token.
//   • GeckoTerminal — OHLCV candles + recent trades for that pair (pool).
//
// Everything is best-effort: any failure returns null / [] and the caller keeps
// the static snapshot (home) or shows an honest empty state (chart/trades). USD
// is the unit throughout, matching the USD market-cap the UI already shows.
// Server-only so these run during SSR (force-dynamic routes) and never ship keys.

const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEXSCREENER = "https://api.dexscreener.com/latest/dex/tokens";
const GECKO = "https://api.geckoterminal.com/api/v2/networks/solana";

export type { MarketStats } from "./types";

// DexScreener and GeckoTerminal are free, key-less, and rate-limited (~30 req/min).
// Every visitor + the chart's 20s poll would otherwise hit them fresh on each
// request — quickly tripping the limit, which surfaces as empty candles (and the
// 1D→15-min fallback failing too, since both calls get 429'd at once). We can't
// rely on Next's fetch cache here: these routes are `force-dynamic`, whose
// interaction with `next.revalidate` is version-dependent. So gate the calls
// behind a tiny in-process TTL memo instead — deterministic, framework-agnostic,
// and warm exactly when it matters (under load instances are reused). Identical
// keys dedupe, so the 1D fallback reuses the 1H view's cached 15-min fetch.
const TTL_MS = 15_000;
const memo = new Map<string, { at: number; v: unknown }>();

/**
 * Run `produce` at most once per `TTL_MS` per `key`, sharing the result across
 * concurrent requests on the same instance. Failures (per `keep`) are never
 * cached, so a transient 429 retries next call instead of sticking for the TTL.
 */
async function memoized<T>(key: string, keep: (v: T) => boolean, produce: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v as T;
  const v = await produce();
  if (keep(v)) memo.set(key, { at: Date.now(), v });
  return v;
}

/** Current market stats for a mint via DexScreener, or null on failure. */
export function getMarketStats(mint: string): Promise<MarketStats | null> {
  return memoized(`stats:${mint}`, (v) => v !== null, () => fetchMarketStats(mint));
}

async function fetchMarketStats(mint: string): Promise<MarketStats | null> {
  try {
    const res = await fetch(`${DEXSCREENER}/${mint}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { pairs?: DexPair[] };
    const pairs = json.pairs ?? [];
    if (!pairs.length) return null;
    // Prefer the deepest-liquidity SOL pair (the canonical pump.fun curve).
    const pair =
      pairs
        .filter((p) => p.quoteToken?.address === SOL_MINT)
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ??
      pairs[0];
    return {
      priceUsd: num(pair.priceUsd),
      priceNative: num(pair.priceNative),
      marketCap: num(pair.marketCap ?? pair.fdv),
      liquidityUsd: num(pair.liquidity?.usd),
      volume24hUsd: num(pair.volume?.h24),
      priceChange24h: num(pair.priceChange?.h24),
      pairAddress: pair.pairAddress,
    };
  } catch {
    return null;
  }
}

// GeckoTerminal OHLCV timeframes per the app's chart toggle.
const TF: Record<string, { resolution: "minute" | "hour" | "day"; aggregate: number }> = {
  "1H": { resolution: "minute", aggregate: 15 }, // 15-min candles across ~12h
  "4H": { resolution: "hour", aggregate: 1 },
  "1D": { resolution: "hour", aggregate: 4 },
};

/**
 * OHLCV candles for a pool, oldest→newest, mapped to the chart's Candle shape.
 * `tf` is the app timeframe ("1H" | "4H" | "1D"); USD prices. Empty on failure.
 */
export async function getCandles(pair: string, tf: string, limit = 60): Promise<Candle[]> {
  const t = TF[tf] ?? TF["1D"];
  const candles = await fetchOhlcv(pair, t.resolution, t.aggregate, limit);
  // A freshly-launched pool often has no hour/day aggregates yet (only minute
  // data exists), which would leave 4H/1D blank. Fall back to the finest grain
  // (15-min) so every timeframe shows real price action from launch — never an
  // empty chart while trades exist.
  if (candles.length === 0 && !(t.resolution === "minute" && t.aggregate === 15)) {
    return fetchOhlcv(pair, "minute", 15, limit);
  }
  return candles;
}

/** One GeckoTerminal OHLCV fetch → chronological Candle[], or [] on failure. Memoized. */
function fetchOhlcv(
  pair: string,
  resolution: "minute" | "hour" | "day",
  aggregate: number,
  limit: number
): Promise<Candle[]> {
  return memoized(
    `ohlcv:${pair}:${resolution}:${aggregate}:${limit}`,
    (v) => v.length > 0,
    () => fetchOhlcvUncached(pair, resolution, aggregate, limit)
  );
}

async function fetchOhlcvUncached(
  pair: string,
  resolution: "minute" | "hour" | "day",
  aggregate: number,
  limit: number
): Promise<Candle[]> {
  try {
    const url = `${GECKO}/pools/${pair}/ohlcv/${resolution}?aggregate=${aggregate}&limit=${limit}&currency=usd`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { attributes?: { ohlcv_list?: number[][] } };
    };
    const list = json.data?.attributes?.ohlcv_list ?? [];
    // GeckoTerminal returns newest-first; the chart wants chronological order.
    return list
      .slice()
      .reverse()
      .map(([, o, h, l, c]) => ({ o, h, l, c }));
  } catch {
    return [];
  }
}

/** Recent trades for a pool, newest-first, mapped to the chart's Trade shape. Memoized. */
export function getRecentTrades(pair: string, n = 10): Promise<Trade[]> {
  return memoized(`trades:${pair}:${n}`, (v) => v.length > 0, () => fetchRecentTrades(pair, n));
}

async function fetchRecentTrades(pair: string, n: number): Promise<Trade[]> {
  try {
    const url = `${GECKO}/pools/${pair}/trades?trade_volume_in_usd_greater_than=0`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { attributes: GeckoTrade }[] };
    const now = Date.now();
    return (json.data ?? []).slice(0, n).map(({ attributes: a }) => {
      const fromSol = a.from_token_address === SOL_MINT;
      const sol = num(fromSol ? a.from_token_amount : a.to_token_amount);
      const tokens = num(fromSol ? a.to_token_amount : a.from_token_amount);
      return {
        addr: shortAddr(a.tx_from_address),
        side: a.kind === "buy" ? "BUY" : "SELL",
        sol: sol.toFixed(2),
        tokens: Math.round(tokens).toLocaleString("en-US"),
        ageSeconds: Math.max(0, Math.round((now - Date.parse(a.block_timestamp)) / 1000)),
      } satisfies Trade;
    });
  } catch {
    return [];
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

function shortAddr(a: string): string {
  return a.length > 9 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

interface DexPair {
  pairAddress: string;
  priceUsd?: string;
  priceNative?: string;
  marketCap?: number;
  fdv?: number;
  quoteToken?: { address?: string };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
}

interface GeckoTrade {
  tx_from_address: string;
  kind: "buy" | "sell";
  from_token_amount: string;
  to_token_amount: string;
  from_token_address: string;
  block_timestamp: string;
}
