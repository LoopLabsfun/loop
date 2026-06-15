"use client";

import type { AgentLogLine, RewardClaim } from "./types";

export interface LoopEngineState {
  balance: number;
  income: number;
  spend: number;
  countdown: number;
  agentLog: AgentLogLine[];
  claims: RewardClaim[];
  /** True once a real agent runtime is streaming activity. */
  live: boolean;
}

// Honest, no simulation. Until the agent runtime is live, the landing shows the
// real on-chain treasury balance (`seedBalance`, read via Helius — 0 pre-launch)
// and empty activity. No fake income/spend/log/claims/countdown. When the
// runtime streams real events (Supabase Realtime), this becomes the live source.
export function useLoopEngine(seedBalance?: number): LoopEngineState {
  return {
    balance: seedBalance ?? 0,
    income: 0,
    spend: 0,
    countdown: 0,
    agentLog: [],
    claims: [],
    live: false,
  };
}
