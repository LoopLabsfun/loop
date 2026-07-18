import "server-only";

import type { Candle, MarketStats, Trade } from "./types";
import { getSolUsd } from "./price";

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
//
// DexScreener only indexes a pair once it sees enough activity — a thin/quiet
// pump.fun bonding-curve token (every Loop project so far) can silently fall
// OUT of its index after a while with no trading. Confirmed live: PLOOP's
// DexScreener lookup returns `pairs: null` right now, so fetchMarketStats used
// to return null and the caller kept the mint-time placeholder snapshot
// ("$30K" market cap) forever — displaying it as if it were real, off by ~12x
// from pump.fun's own reported $2.4K. fetchPumpFunFallback below is the second
// source: pump.fun's own coin API, authoritative for any bonding-curve token
// regardless of DexScreener's indexing state.

const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEXSCREENER = "https://api.dexscreener.com/latest/dex/tokens";
const GECKO = "https://api.geckoterminal.com/api/v2/networks/solana";
const PUMPFUN_COINS = "https://frontend-api-v3.pump.fun/coins";

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
  const fromDexScreener = await fetchDexScreenerStats(mint);
  return fromDexScreener ?? fetchPumpFunStats(mint);
}

async function fetchDexScreenerStats(mint: string): Promise<MarketStats | null> {
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
    // Graduation = a pair exists on a real AMM (not the pump.fun bonding curve).
    // Pre-graduation DexScreener only lists the "pumpfun" pair; once it migrates,
    // a "pumpswap"/"raydium"/etc. pair appears. This is the truthful on-curve vs
    // graduated signal — no stored snapshot, no $-threshold guessing.
    const graduated = pairs.some(
      (p) => p.dexId && p.dexId.toLowerCase() !== "pumpfun"
    );
    return {
      priceUsd: num(pair.priceUsd),
      priceNative: num(pair.priceNative),
      marketCap: num(pair.marketCap ?? pair.fdv),
      liquidityUsd: num(pair.liquidity?.usd),
      volume24hUsd: num(pair.volume?.h24),
      priceChange24h: num(pair.priceChange?.h24),
      pairAddress: pair.pairAddress,
      graduated,
    };
  } catch {
    return null;
  }
}

interface PumpFunCoin {
  usd_market_cap?: number;
  total_supply?: number | string;
  base_decimals?: number;
  real_sol_reserves?: number;
  bonding_curve?: string;
  complete?: boolean;
}

/** Fallback when DexScreener hasn't (or no longer) indexed this pair — reads
 *  pump.fun's own coin API directly, so a thin/quiet bonding-curve token never
 *  falls back to the mint-time placeholder snapshot as if it were live data. */
async function fetchPumpFunStats(mint: string): Promise<MarketStats | null> {
  try {
    const res = await fetch(`${PUMPFUN_COINS}/${mint}`, { cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as PumpFunCoin;
    if (typeof j.usd_market_cap !== "number" || !Number.isFinite(j.usd_market_cap)) return null;
    const decimals = j.base_decimals ?? 6;
    const supply = Number(j.total_supply ?? 0) / 10 ** decimals;
    const priceUsd = supply > 0 ? j.usd_market_cap / supply : 0;
    const solUsd = await getSolUsd();
    return {
      priceUsd,
      priceNative: solUsd > 0 ? priceUsd / solUsd : 0,
      marketCap: j.usd_market_cap,
      // The bonding curve's real SOL side — the honest liquidity figure pump.fun
      // itself reports for an unmigrated coin (there's no separate AMM pool yet).
      liquidityUsd: ((j.real_sol_reserves ?? 0) / 1e9) * solUsd,
      // pump.fun's coin object doesn't report 24h volume — 0 is an honest
      // "unknown", unlike the placeholder's invented "0 SOL" that reads as real.
      volume24hUsd: 0,
      priceChange24h: 0,
      pairAddress: j.bonding_curve ?? "",
      graduated: Boolean(j.complete),
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
    return densify(list.slice().reverse(), bucketSeconds(resolution, aggregate), limit);
  } catch {
    return [];
  }
}

function bucketSeconds(resolution: "minute" | "hour" | "day", aggregate: number): number {
  const unit = resolution === "minute" ? 60 : resolution === "hour" ? 3600 : 86400;
  return unit * aggregate;
}

/**
 * A thin market only produces candles for buckets that actually traded, so a
 * quiet token renders as 2–3 fat bars — it reads as a bug. Fill the gaps (and
 * the stretch up to now) with flat candles at the previous close, like every
 * real charting product, capped at `limit` most-recent buckets.
 */
export function densify(rows: number[][], bucketS: number, limit: number): Candle[] {
  if (rows.length === 0 || bucketS <= 0) return [];
  const out: { t: number; o: number; h: number; l: number; c: number }[] = [];
  for (const [t, o, h, l, c] of rows) {
    const prev = out[out.length - 1];
    if (prev) {
      for (let ts = prev.t + bucketS; ts < t && out.length < 5_000; ts += bucketS) {
        out.push({ t: ts, o: prev.c, h: prev.c, l: prev.c, c: prev.c });
      }
    }
    out.push({ t, o, h, l, c });
  }
  // Extend flat to the current bucket so a month-old last trade doesn't render
  // as the rightmost candle (which reads as "traded just now").
  const last = out[out.length - 1]!;
  const nowBucket = Math.floor(Date.now() / 1000 / bucketS) * bucketS;
  for (let ts = last.t + bucketS; ts <= nowBucket && out.length < 10_000; ts += bucketS) {
    out.push({ t: ts, o: last.c, h: last.c, l: last.c, c: last.c });
  }
  return out.slice(-limit).map(({ o, h, l, c }) => ({ o, h, l, c }));
}

/**
 * Recent trades for a pool, newest-first. GeckoTerminal only surfaces *recent*
 * activity, so a quiet token gets [] — which the UI renders as "No recent
 * trades" and reads as broken. Fall back to Helius transaction history for the
 * pool (last swaps whatever their age; the UI shows "30d ago" honestly).
 */
export function getRecentTrades(pair: string, n = 10, mint?: string): Promise<Trade[]> {
  return memoized(`trades:${pair}:${n}:${mint ?? ""}`, (v) => v.length > 0, async () => {
    const gecko = await fetchRecentTrades(pair, n);
    if (gecko.length > 0 || !mint) return gecko;
    return fetchTradesHelius(pair, mint, n);
  });
}

/** Last swaps on the pool from Helius enhanced transactions (any age). */
async function fetchTradesHelius(pair: string, mint: string, n: number): Promise<Trade[]> {
  const key = process.env.HELIUS_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://api.helius.xyz/v0/addresses/${pair}/transactions?api-key=${key}&limit=50`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const txs = (await res.json()) as {
      type?: string;
      timestamp?: number;
      tokenTransfers?: { mint?: string; tokenAmount?: number; fromUserAccount?: string; toUserAccount?: string }[];
      nativeTransfers?: { amount?: number; fromUserAccount?: string; toUserAccount?: string }[];
    }[];
    const now = Date.now() / 1000;
    const out: Trade[] = [];
    for (const tx of txs) {
      if (tx.type !== "SWAP") continue;
      const move = (tx.tokenTransfers ?? []).find((t) => t.mint === mint && (t.tokenAmount ?? 0) > 0);
      if (!move) continue;
      // Pool sends tokens to the user → BUY; user sends tokens to the pool → SELL.
      const buy = move.fromUserAccount === pair;
      const user = (buy ? move.toUserAccount : move.fromUserAccount) ?? "";
      // SOL leg: lamports crossing the pool boundary in the opposite direction.
      const lamports = (tx.nativeTransfers ?? [])
        .filter((x) => (buy ? x.toUserAccount === pair : x.fromUserAccount === pair))
        .reduce((s, x) => s + (x.amount ?? 0), 0);
      out.push({
        addr: shortAddr(user),
        side: buy ? "BUY" : "SELL",
        sol: (lamports / 1e9).toFixed(2),
        tokens: Math.round(move.tokenAmount ?? 0).toLocaleString("en-US"),
        ageSeconds: Math.max(0, Math.round(now - (tx.timestamp ?? now))),
      });
      if (out.length >= n) break;
    }
    return out;
  } catch {
    return [];
  }
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
  dexId?: string;
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
