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

export function useTokenMarket(project: Project) {
  const [tf, setTf] = useState<Timeframe>("1D");
  const [mode, setMode] = useState<ChartMode>("candles");
  const [candles, setCandles] = useState<Candle[]>(() =>
    genCandles("1D", project.price)
  );
  const [trades, setTrades] = useState<Trade[]>(() =>
    genTrades(project.price, 7)
  );
  const [agentLog, setAgentLog] = useState<AgentLogLine[]>(TOKEN_LOG);
  const logTick = useRef(0);

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
