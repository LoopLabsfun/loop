// Core domain types for Loop. These mirror what a real backend
// (Supabase + Solana RPC + Pump.fun/Bags.fun reward feeds) would return,
// so the simulation in `lib/api.ts` can be swapped for live data without
// touching the UI components.

export type Launchpad = "Pump.fun" | "Bags.fun";

/** Solana cluster a project / the session targets. */
export type Network = "mainnet" | "devnet";

// LOOP is the only static (fallback) project. Launched projects carry arbitrary
// slug keys in the DB; lib/queries.ts casts those.
export type ProjectKey = "loop";

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
  // Economics + steering (see lib/fees.ts, docs/loop-economics.md).
  /** Founder share of creator fees, 0..95 (agent = 95 − this; platform = 5). */
  feeFounderPct?: number;
  /** Agent wallet pubkey (custody provider–backed); null until provisioned. */
  agentWallet?: string | null;
  /** Founder/DAO content policy steering the agent. */
  contentPolicy?: string | null;
  /** Editable guardrails the agent rereads each cycle. */
  guardrails?: string | null;
  /** True when `treasurySol` came from a live on-chain read this request. */
  treasuryLive?: boolean;
  /**
   * uiAmount of the project's OWN token (`mint`) held by `treasuryWallet`, from a
   * live on-chain read — null/undefined until read. The treasury card surfaces it
   * as a separate line (its market value is illiquid/circular, so it's shown
   * alongside the spendable SOL, never folded into it).
   */
  treasuryTokenUi?: number | null;
  /**
   * Real on-chain SOL-balance trajectory of `treasuryWallet`, oldest→newest,
   * reconstructed from tx history — null/undefined until read. Powers the
   * treasury sparkline (event-spaced; every value is a real balance level).
   */
  treasuryHistory?: { t: number; sol: number }[] | null;
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

/** Live market stats for a launched token (USD throughout). */
export interface MarketStats {
  priceUsd: number;
  /** Price in SOL (the native/quote price). */
  priceNative: number;
  marketCap: number;
  liquidityUsd: number;
  volume24hUsd: number;
  /** 24h price change in percent (may be negative). */
  priceChange24h: number;
  /** The pump.fun pair/pool address — used to fetch candles + trades. */
  pairAddress: string;
  /**
   * True once the token has migrated off the pump.fun bonding curve (a pair
   * exists on an AMM like PumpSwap/Raydium). Derived live from DexScreener, not
   * a stored snapshot — so the UI reflects the real graduation state.
   */
  graduated: boolean;
}

/** A token holder's share of supply (0..1), for governance + wind-down math. */
export interface Holder {
  address: string;
  share: number;
  /** Primary Solana Name Service (.sol) name for `address`, if any (else null). */
  name?: string | null;
}

/** A SOL payout to a holder (e.g. a wind-down distribution). */
export interface Payout {
  address: string;
  sol: number;
}
