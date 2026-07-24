"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Candle, MarketStats, Trade } from "./types";

export type Timeframe = "1H" | "4H" | "1D" | "ALL";
export type ChartMode = "candles" | "line";

export interface LiveMarketSeed {
  stats: MarketStats | null;
  candles: Candle[];
  trades: Trade[];
}

/** Where the refresh polls. Solana reads /api/market by mint; Hood reads
 *  /api/hood-market, which needs the project slug to pick the launchpad. */
export interface MarketSource {
  chain?: "solana" | "hood";
  slug?: string;
}

const POLL_MS = 20_000;
/** Live-price tick. Cheap: /api/price is one memoized DexScreener read. */
const PRICE_POLL_MS = 5_000;
/** Beyond this the live price and the candle source disagree (different pool,
 *  stale feed) — folding it in would draw a wick that never traded. */
const LIVE_TICK_MAX_DRIFT = 0.2;

/**
 * Live market for a launched token. Seeded with the server-rendered snapshot,
 * then refreshes from /api/market: refetches candles on timeframe change and
 * polls stats + trades + candles every ~20s. Pre-launch (no mint) ⇒ no market:
 * empty series, no polling — the UI shows honest "no market yet" states.
 */
export function useLiveMarket(
  mint: string | null | undefined,
  seed: LiveMarketSeed,
  source: MarketSource = {}
) {
  const preLaunch = !mint;
  const isHood = source.chain === "hood";
  const [tf, setTf] = useState<Timeframe>("1H");
  const [mode, setMode] = useState<ChartMode>("candles");
  const [stats, setStats] = useState<MarketStats | null>(seed.stats);
  const [candles, setCandles] = useState<Candle[]>(seed.candles);
  const [trades, setTrades] = useState<Trade[]>(seed.trades);
  const tfRef = useRef(tf);
  tfRef.current = tf;

  const fetchMarket = useCallback(
    async (timeframe: Timeframe) => {
      if (!mint) return;
      // Hood tokens read the EVM route (Pons pool logs); it needs the slug to
      // resolve the launchpad. A Hood token with no slug simply can't refresh —
      // it keeps the server-rendered seed.
      const url = isHood
        ? source.slug &&
          `/api/hood-market?mint=${encodeURIComponent(mint)}&p=${encodeURIComponent(source.slug)}&tf=${timeframe}`
        : `/api/market?mint=${encodeURIComponent(mint)}&tf=${timeframe}`;
      if (!url) return;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Partial<LiveMarketSeed>;
        // Ignore a stale response if the user switched timeframe meanwhile.
        if (tfRef.current !== timeframe) return;
        if (data.stats !== undefined) setStats(data.stats);
        if (data.candles?.length) setCandles(data.candles);
        if (data.trades) setTrades(data.trades);
      } catch {
        // keep the last good snapshot on a failed refresh
      }
    },
    [mint, isHood, source.slug]
  );

  const changeTf = useCallback(
    (next: Timeframe) => {
      setTf(next);
      void fetchMarket(next);
    },
    [fetchMarket]
  );

  // Poll while the token is live.
  useEffect(() => {
    if (preLaunch) return;
    const id = setInterval(() => void fetchMarket(tfRef.current), POLL_MS);
    return () => clearInterval(id);
  }, [preLaunch, fetchMarket]);

  // Live price tick between the heavy refreshes, so the forming candle moves
  // with the market instead of jumping once every 20s. Solana only — /api/price
  // is a Solana route; Hood rides the 20s market poll.
  const [livePrice, setLivePrice] = useState<number | null>(null);
  useEffect(() => {
    if (!mint || isHood) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/price?mint=${encodeURIComponent(mint)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const { priceUsd } = (await res.json()) as { priceUsd: number | null };
        if (alive && typeof priceUsd === "number" && priceUsd > 0) setLivePrice(priceUsd);
      } catch {
        // a missed tick just leaves the last candle where it was
      }
    };
    void tick();
    const id = setInterval(() => void tick(), PRICE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [mint, isHood]);

  const liveCandles = useMemo(
    () => withLiveTick(candles, livePrice),
    [candles, livePrice]
  );

  return {
    tf,
    mode,
    stats,
    candles: liveCandles,
    trades,
    changeTf,
    setMode,
    preLaunch,
    livePrice,
  };
}

/**
 * Fold the live price into the forming (last) candle: close follows the market,
 * high/low stretch to contain it — exactly what an exchange chart does inside
 * the current bucket. Ignored when the price drifts implausibly far from the
 * candle feed, since that means the two sources disagree rather than that the
 * market moved.
 */
export function withLiveTick(candles: Candle[], price: number | null): Candle[] {
  const last = candles[candles.length - 1];
  if (!last || price == null || price <= 0) return candles;
  if (Math.abs(price - last.c) / last.c > LIVE_TICK_MAX_DRIFT) return candles;
  if (price === last.c) return candles;
  return [
    ...candles.slice(0, -1),
    { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) },
  ];
}
