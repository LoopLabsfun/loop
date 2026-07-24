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

/**
 * Every upstream here is a free public API with no SLA — a stalled DexScreener
 * or GeckoTerminal connection would otherwise hang the whole request, and these
 * run during SSR of a force-dynamic page, so the token page itself would hang
 * with it. Cap each call; a timeout throws and the caller's catch degrades to
 * the honest empty state.
 */
const UPSTREAM_TIMEOUT_MS = 4_000;
/** Total time the candle grain-cascade may spend before giving up (below). */
const CASCADE_BUDGET_MS = 6_000;

function fetchUpstream(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    cache: "no-store",
    ...init,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

/** Current market stats for a mint via DexScreener, or null on failure. */
export function getMarketStats(mint: string): Promise<MarketStats | null> {
  return memoized(`stats:${mint}`, (v) => v !== null, () => fetchMarketStats(mint));
}

/**
 * The pool candles/trades should be read from. `stats.pairAddress` is NOT it
 * for a graduated token whose stats came from the pump.fun fallback: that field
 * is the *bonding curve*, which goes dead at graduation — charting it renders
 * launch-day data forever at a price ~14x off the live one (confirmed on LOOP).
 * Ask GeckoTerminal for every pool holding this mint and pick the deepest by
 * reserve — the same "canonical market" rule pump.fun's own UI applies. Falls
 * back to `stats.pairAddress` when the listing fails.
 */
export async function resolveTradingPool(mint: string, fallback: string): Promise<string> {
  return (await getCanonicalPool(mint))?.addr ?? fallback;
}

/** The deepest pool for a mint plus the live stats GeckoTerminal reports for it.
 *  Fetched once and memoized; both resolveTradingPool and the stats overlay
 *  (below) read it, so the extra numbers cost no extra request. */
interface CanonicalPool {
  addr: string;
  reserveUsd: number;
  volume24hUsd: number;
  priceChange24h: number;
  priceUsd: number;
}

function getCanonicalPool(mint: string): Promise<CanonicalPool | null> {
  return memoized<CanonicalPool | null>(`pool:${mint}`, (v) => v !== null, async () => {
    try {
      const res = await fetchUpstream(`${GECKO}/tokens/${mint}/pools`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: GeckoPool[] };
      const top = (json.data ?? [])
        .map((p) => ({ p, reserve: num(p.attributes?.reserve_in_usd) }))
        .filter((x) => x.p.id)
        .sort((a, b) => b.reserve - a.reserve)[0];
      if (!top) return null;
      const a = top.p.attributes ?? {};
      return {
        // Gecko pool ids are "solana_<address>".
        addr: (top.p.id ?? "").replace(/^solana_/, ""),
        reserveUsd: top.reserve,
        volume24hUsd: num(a.volume_usd?.h24),
        priceChange24h: num(a.price_change_percentage?.h24),
        priceUsd: num(a.base_token_price_usd),
      };
    } catch {
      return null;
    }
  });
}

async function fetchMarketStats(mint: string): Promise<MarketStats | null> {
  const base = (await fetchDexScreenerStats(mint)) ?? (await fetchPumpFunStats(mint));
  if (!base) return null;
  // For a graduated token, `base` came from the pump.fun bonding curve, which
  // reads $0 liquidity and no volume once it's dead — the same reason the chart
  // had to move to the canonical pool. Overlay the deepest live pool's figures
  // for any field the base source left at 0, so the header stops showing "—"
  // liquidity on a token that plainly has a pool. Same fetch resolveTradingPool
  // already makes, so no extra request.
  const pool = await getCanonicalPool(mint);
  if (!pool) return base;
  const merged: MarketStats = {
    ...base,
    liquidityUsd: base.liquidityUsd > 0 ? base.liquidityUsd : pool.reserveUsd,
    volume24hUsd: base.volume24hUsd > 0 ? base.volume24hUsd : pool.volume24hUsd,
    priceChange24h: base.priceChange24h !== 0 ? base.priceChange24h : pool.priceChange24h,
  };
  // Align the headline price to the pool the chart actually draws. The base
  // price can be the dead bonding curve's (a graduated token off DexScreener's
  // index falls back to pump.fun), leaving the header ~3% off the candle the
  // user reads right below it. Market cap is price × supply, so rescale it by
  // the same ratio rather than letting the two disagree. Supply is implied by
  // the base pair (mcap ÷ price), not restated.
  if (pool.priceUsd > 0 && base.priceUsd > 0) {
    const supply = base.marketCap / base.priceUsd;
    merged.priceUsd = pool.priceUsd;
    merged.priceNative = base.priceNative * (pool.priceUsd / base.priceUsd);
    if (Number.isFinite(supply) && supply > 0) merged.marketCap = pool.priceUsd * supply;
  }
  return merged;
}

async function fetchDexScreenerStats(mint: string): Promise<MarketStats | null> {
  try {
    const res = await fetchUpstream(`${DEXSCREENER}/${mint}`);
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
    const res = await fetchUpstream(`${PUMPFUN_COINS}/${mint}`);
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
  ALL: { resolution: "day", aggregate: 1 }, // daily candles since launch
};

// ALL wants the full life of the token, not the last 60 buckets — Gecko caps
// a single OHLCV call at 1000 rows, and densify caps filler the same way.
const TF_LIMIT: Record<string, number> = { ALL: 365 };

/**
 * OHLCV candles for a pool, oldest→newest, mapped to the chart's Candle shape.
 * `tf` is the app timeframe ("1H" | "4H" | "1D"); USD prices. Empty on failure.
 */
export function getCandles(pair: string, tf: string, limit = TF_LIMIT[tf] ?? 60): Promise<Candle[]> {
  // Memoize the whole cascade, not just each grain: the cascade can hit Gecko
  // up to 4x per call, and the 20s poll would trip the ~30 req/min limit —
  // which then 429s every grain and blanks the chart entirely.
  // Empty results are cached too (unlike the per-grain memo): an empty cascade
  // means every grain failed or is quiet, and retrying 4 upstream calls on each
  // 20s poll while 429'd only digs the hole deeper. 15s later it retries anyway.
  return memoized(`candles:${pair}:${tf}:${limit}`, () => true, () =>
    fetchCandlesCascade(pair, tf, limit)
  );
}

async function fetchCandlesCascade(pair: string, tf: string, limit: number): Promise<Candle[]> {
  const t = TF[tf] ?? TF["1D"];
  // Cascade through grains until one has real data. Both directions matter:
  // a fresh pool only has minute data (hour/day aggregates lag), while a quiet
  // pool's 15-min window is pure flat filler — real trades only appear at
  // hour/day grain. "Real" = at least one candle actually traded (v > 0);
  // a window of nothing but densify-filler misrepresents a dead stretch as
  // the whole market, so it loses to any grain with genuine price action.
  const grains = [
    [t.resolution, t.aggregate] as const,
    ["minute", 15] as const,
    ["hour", 4] as const,
    ["day", 1] as const,
  ].filter(
    ([res, agg], i) => i === 0 || res !== t.resolution || agg !== t.aggregate
  );
  // The cascade must not multiply a slow upstream by four: when GeckoTerminal is
  // rate-limiting, each grain burns the full per-call timeout and the route ends
  // up hanging for half a minute (it also blocks SSR of the token page). Stop
  // trying further grains once the budget is spent and return the best answer so
  // far — the next poll retries with a fresh budget.
  const deadline = Date.now() + CASCADE_BUDGET_MS;
  let firstNonEmpty: Candle[] = [];
  for (const [resolution, aggregate] of grains) {
    const candles = await fetchOhlcv(pair, resolution, aggregate, limit);
    if (candles.some((c) => (c.v ?? 0) > 0)) return candles;
    if (!firstNonEmpty.length) firstNonEmpty = candles;
    if (Date.now() > deadline) break;
  }
  return firstNonEmpty;
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
    const res = await fetchUpstream(url, { headers: { Accept: "application/json" } });
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
  const out: Required<Candle>[] = [];
  for (const [t, o, h, l, c, v = 0] of rows) {
    const prev = out[out.length - 1];
    if (prev) {
      for (let ts = prev.t + bucketS; ts < t && out.length < 5_000; ts += bucketS) {
        out.push({ t: ts, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
      }
    }
    out.push({ t, o, h, l, c, v });
  }
  // Extend flat to the current bucket so a month-old last trade doesn't render
  // as the rightmost candle (which reads as "traded just now").
  const last = out[out.length - 1]!;
  const nowBucket = Math.floor(Date.now() / 1000 / bucketS) * bucketS;
  for (let ts = last.t + bucketS; ts <= nowBucket && out.length < 10_000; ts += bucketS) {
    out.push({ t: ts, o: last.c, h: last.c, l: last.c, c: last.c, v: 0 });
  }
  return out.slice(-limit);
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
    const res = await fetchUpstream(
      `https://api.helius.xyz/v0/addresses/${pair}/transactions?api-key=${key}&limit=50`
    );
    if (!res.ok) return [];
    const txs = (await res.json()) as {
      type?: string;
      signature?: string;
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
      // SOL leg, opposite direction across the pool boundary. On a graduated
      // AMM pool (PumpSwap/Raydium) the SOL side is a *wrapped* SOL token
      // transfer, not a native one — only the bonding curve moves lamports
      // directly. Take the WSOL leg when present; summing every native
      // transfer in the tx also caught unrelated routing legs (a 0.67 SOL
      // buy showed as 10 SOL), so native is the curve-era fallback only.
      const wsol = (tx.tokenTransfers ?? [])
        .filter(
          (x) =>
            x.mint === SOL_MINT &&
            (buy ? x.toUserAccount === pair : x.fromUserAccount === pair)
        )
        .reduce((s, x) => s + (x.tokenAmount ?? 0), 0);
      const lamports = (tx.nativeTransfers ?? [])
        .filter((x) => (buy ? x.toUserAccount === pair : x.fromUserAccount === pair))
        .reduce((s, x) => s + (x.amount ?? 0), 0);
      const solAmount = wsol > 0 ? wsol : lamports / 1e9;
      out.push({
        addr: shortAddr(user),
        fullAddr: user || undefined,
        side: buy ? "BUY" : "SELL",
        sol: fmtSolAmount(solAmount),
        tokens: Math.round(move.tokenAmount ?? 0).toLocaleString("en-US"),
        ageSeconds: Math.max(0, Math.round(now - (tx.timestamp ?? now))),
        sig: tx.signature,
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
    const res = await fetchUpstream(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { attributes: GeckoTrade }[] };
    const now = Date.now();
    return (json.data ?? []).slice(0, n).map(({ attributes: a }) => {
      const fromSol = a.from_token_address === SOL_MINT;
      const sol = num(fromSol ? a.from_token_amount : a.to_token_amount);
      const tokens = num(fromSol ? a.to_token_amount : a.from_token_amount);
      // Per-token USD price of the token side of the swap (Gecko quotes both legs).
      const priceUsd = num(fromSol ? a.price_to_in_usd : a.price_from_in_usd) || undefined;
      return {
        addr: shortAddr(a.tx_from_address),
        fullAddr: a.tx_from_address || undefined,
        side: a.kind === "buy" ? "BUY" : "SELL",
        sol: fmtSolAmount(sol),
        tokens: Math.round(tokens).toLocaleString("en-US"),
        ageSeconds: Math.max(0, Math.round((now - Date.parse(a.block_timestamp)) / 1000)),
        sig: a.tx_hash,
        priceUsd,
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

/** SOL amount for the trades list: 2 decimals normally, 4 for dust. */
function fmtSolAmount(v: number): string {
  return v >= 0.1 || v === 0 ? v.toFixed(2) : v.toFixed(4);
}

function shortAddr(a: string): string {
  return a.length > 9 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

interface GeckoPool {
  id?: string;
  attributes?: {
    reserve_in_usd?: string;
    base_token_price_usd?: string;
    volume_usd?: { h24?: string };
    price_change_percentage?: { h24?: string };
  };
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
  tx_hash?: string;
  tx_from_address: string;
  kind: "buy" | "sell";
  from_token_amount: string;
  to_token_amount: string;
  from_token_address: string;
  /** Per-token USD price of each swap leg (GeckoTerminal quotes both). */
  price_from_in_usd?: string;
  price_to_in_usd?: string;
  block_timestamp: string;
}
