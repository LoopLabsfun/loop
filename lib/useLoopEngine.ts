"use client";

import { useEffect, useRef, useState } from "react";
import {
  AGENT_LOG_POOL,
  getInitialAgentLog,
  getRecentClaims,
  getTreasury,
} from "./api";
import type { AgentLogLine, RewardClaim } from "./types";
import { nowStamp } from "./format";

export interface LoopEngineState {
  balance: number;
  income: number;
  spend: number;
  countdown: number;
  agentLog: AgentLogLine[];
  claims: RewardClaim[];
}

// Drives the landing page's "live" treasury + agent terminal. This is the
// simulation counterpart to a real-time feed; the shape it produces matches
// what a WebSocket/Supabase-Realtime subscription would push.
// `seedBalance` lets a server component pass the real on-chain treasury balance
// (read via Helius) as the starting point; the tick then animates from there.
export function useLoopEngine(seedBalance?: number): LoopEngineState {
  const t0 = getTreasury("loop");
  const [state, setState] = useState<LoopEngineState>({
    balance: seedBalance ?? t0.balanceSol,
    income: t0.income24hSol,
    spend: t0.spend24hSol,
    countdown: t0.nextCheckSeconds,
    agentLog: getInitialAgentLog(),
    claims: getRecentClaims(),
  });

  const tick = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      setState((s) => {
        const next: LoopEngineState = { ...s };
        next.countdown = s.countdown > 0 ? s.countdown - 1 : 180;

        if (s.countdown % 4 === 0) {
          const bump = 0.001 + Math.random() * 0.004;
          next.balance = s.balance + bump;
          next.income = s.income + bump;
        }

        // The agent burns treasury as it runs — a smaller, steady outflow than
        // income so the net trend stays positive while the wallet is funded.
        if (s.countdown % 6 === 0) {
          const burn = 0.0005 + Math.random() * 0.0015;
          next.spend = s.spend + burn;
          next.balance = next.balance - burn;
        }

        if (s.countdown % 3 === 0) {
          const pool = [
            ...AGENT_LOG_POOL,
            "commit " +
              Math.random().toString(16).slice(2, 9) +
              " pushed → github.com/godisrupt/loop-fun",
            "budget check: " + (next.balance * 0.6).toFixed(2) + " SOL available",
          ];
          const msg = pool[Math.floor(Math.random() * pool.length)];
          next.agentLog = [...s.agentLog.slice(-5), { t: nowStamp(), msg }];
        }

        if (s.countdown === 0) {
          const amt = (0.08 + Math.random() * 0.16).toFixed(2);
          next.claims = [
            { when: "just now", amount: amt, source: "Pump.fun" },
            ...s.claims.slice(0, 3),
          ];
          next.balance = next.balance + parseFloat(amt);
        }

        return next;
      });
      tick.current += 1;
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return state;
}
