"use client";

import { useEffect, useRef, useState } from "react";
import { genCandles, genTrades, mkTrade, getInitialAgentLog } from "./api";
import type { AgentLogLine, Candle, Project, Trade } from "./types";
import { nowStamp } from "./format";

export type Timeframe = "1H" | "4H" | "1D";
export type ChartMode = "candles" | "line";

const TOKEN_LOG: AgentLogLine[] = [
  { t: "[12:45:01]", msg: "claiming rewards … +0.12 SOL" },
  { t: "[12:45:03]", msg: "deposited to treasury ✓" },
  { t: "[12:45:05]", msg: "starting coding cycle …" },
  { t: "[12:45:11]", msg: "running tests ✓ 38 passed" },
];

const LOG_POOL = [
  "analyzing open issues …",
  "generating code … 388 tokens/s",
  "running tests ✓ 41 passed",
  "deploying preview build ✓",
  "claiming rewards … +0.09 SOL",
  "deposited to treasury ✓",
];

// Deterministic seeds for the FIRST render so server SSR and client hydration
// match (no Math.random). After mount we swap in the randomized series.
function seedCandles(price: number): Candle[] {
  const out: Candle[] = [];
  let prev = price * 0.86;
  for (let i = 0; i < 48; i++) {
    const c = price * (0.86 + (0.14 * i) / 47);
    const o = prev;
    out.push({ o, h: Math.max(o, c) * 1.008, l: Math.min(o, c) * 0.992, c });
    prev = c;
  }
  return out;
}

function seedTrades(price: number): Trade[] {
  const rows: [string, "BUY" | "SELL", number, number][] = [
    ["7xKq…g4fR", "BUY", 1.2, 6],
    ["3mQz…r8Lk", "SELL", 0.45, 24],
    ["Hv9c…2dWp", "BUY", 2.1, 51],
    ["Bn4t…9xQa", "BUY", 0.32, 78],
    ["Kp2w…5mRv", "SELL", 1.05, 120],
    ["Qd8a…7nLf", "BUY", 0.74, 168],
    ["Zr3x…1cVe", "BUY", 0.9, 210],
  ];
  return rows.map(([addr, side, s, age]) => ({
    addr,
    side,
    sol: s.toFixed(2),
    tokens: Math.round((s * 164) / price).toLocaleString("en-US"),
    ageSeconds: age,
  }));
}

export function useTokenMarket(project: Project) {
  const [tf, setTf] = useState<Timeframe>("1D");
  const [mode, setMode] = useState<ChartMode>("candles");
  // Deterministic on first paint (matches SSR); randomized after mount.
  const [candles, setCandles] = useState<Candle[]>(() =>
    seedCandles(project.price)
  );
  const [trades, setTrades] = useState<Trade[]>(() =>
    seedTrades(project.price)
  );
  const [agentLog, setAgentLog] = useState<AgentLogLine[]>(TOKEN_LOG);
  const logTick = useRef(0);

  // Swap in the lively randomized series once we're on the client.
  useEffect(() => {
    setCandles(genCandles("1D", project.price));
    setTrades(genTrades(project.price, 7));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-seed candles when the timeframe changes.
  const changeTf = (next: Timeframe) => {
    setTf(next);
    setCandles(genCandles(next, project.price));
  };

  useEffect(() => {
    const id = setInterval(() => {
      // Nudge the last candle.
      setCandles((cs) => {
        if (!cs.length) return cs;
        const next = cs.slice();
        const last = { ...next[next.length - 1] };
        const d = 1 + 0.004 * (Math.random() - 0.46);
        last.c = last.c * d;
        last.h = Math.max(last.h, last.c);
        last.l = Math.min(last.l, last.c);
        next[next.length - 1] = last;
        return next;
      });
      // Age trades, occasionally prepend a new one.
      setTrades((ts) => {
        let next = ts.map((t) => ({ ...t, ageSeconds: t.ageSeconds + 2 }));
        if (Math.random() > 0.45) {
          next = [mkTrade(project.price, 0), ...next.slice(0, 8)];
        }
        return next;
      });
      // Append an agent log line every ~6s.
      logTick.current += 1;
      if (logTick.current % 3 === 0) {
        const msg = LOG_POOL[Math.floor(Math.random() * LOG_POOL.length)];
        setAgentLog((l) => [...l.slice(-3), { t: nowStamp(), msg }]);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [project.price]);

  return { tf, mode, candles, trades, agentLog, changeTf, setMode };
}
