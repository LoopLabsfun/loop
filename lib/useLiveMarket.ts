"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle, MarketStats, Trade } from "./types";

export type Timeframe = "1H" | "4H" | "1D" | "ALL";
export type ChartMode = "candles" | "line";

export interface LiveMarketSeed {
  stats: MarketStats | null;
  candles: Candle[];
  trades: Trade[];
}

const POLL_MS = 20_000;

/**
 * Live market for a launched token. Seeded with the server-rendered snapshot,
 * then refreshes from /api/market: refetches candles on timeframe change and
 * polls stats + trades + candles every ~20s. Pre-launch (no mint) ⇒ no market:
 * empty series, no polling — the UI shows honest "no market yet" states.
 */
export function useLiveMarket(mint: string | null | undefined, seed: LiveMarketSeed) {
  const preLaunch = !mint;
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
      try {
        const res = await fetch(
          `/api/market?mint=${encodeURIComponent(mint)}&tf=${timeframe}`,
          { cache: "no-store" }
        );
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
    [mint]
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

  return { tf, mode, stats, candles, trades, changeTf, setMode, preLaunch };
}
