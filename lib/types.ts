// Core domain types for Loop. These mirror what a real backend
// (Supabase + Solana RPC + Pump.fun/Bags.fun reward feeds) would return,
// so the simulation in `lib/api.ts` can be swapped for live data without
// touching the UI components.

export type Launchpad = "Pump.fun" | "Bags.fun";

/** Solana cluster a project / the session targets. */
export type Network = "mainnet" | "devnet";

export type ProjectKey = "loop" | "gtavi" | "owrpg" | "aivid";

/** Static + slow-moving metadata for a project. */
export interface Project {
  key: ProjectKey;
  name: string;
  ticker: string; // includes leading "$"
  description: string;
  official: boolean;
  launchpad: Launchpad;
  repo: string;
  /** Tailwind gradient classes used for the card / header cover. */
  cover: string;
  // Market snapshot
  price: number;
  marketCap: string;
  liquidity: string;
  holders: string;
  volume24h: string;
  /** Bonding-curve progress 0..1 */
  curve: number;
  supply: string;
  // Treasury snapshot
  treasurySol: number;
  earnedSol: number;
  burnPerDay: string;
  runway: string;
  // On-chain references (optional). When `treasuryWallet` is set, `treasurySol`
  // is replaced with the live balance read from Helius.
  treasuryWallet?: string | null;
  mint?: string | null;
  network?: Network;
  /** Verified launcher pubkey (Founder); enables founder-mode in the console. */
  creatorWallet?: string | null;
  /** True when `treasurySol` came from a live on-chain read this request. */
  treasuryLive?: boolean;
}

/** A live treasury reading. Animated client-side in the simulation. */
export interface Treasury {
  wallet: string;
  balanceSol: number;
  totalEarnedSol: number;
  income24hSol: number;
  spend24hSol: number;
  burnPerDay: string;
  /** seconds until the agent's next funding/work check */
  nextCheckSeconds: number;
}

export interface RewardClaim {
  when: string;
  amount: string; // SOL, formatted
  source?: Launchpad;
}

export interface Commit {
  message: string;
  when?: string;
}

export interface AgentLogLine {
  t: string; // "[HH:MM:SS]"
  msg: string;
}

export interface Trade {
  addr: string;
  side: "BUY" | "SELL";
  sol: string;
  tokens: string;
  ageSeconds: number;
}

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}
