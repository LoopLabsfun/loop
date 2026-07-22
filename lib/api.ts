// ─────────────────────────────────────────────────────────────────────────────
// Launch input/output types.
//
// This module once held the client-side SIMULATION SEAM (treasury ticks, candles,
// trades, agent log). All of that is now real — market data via lib/market.ts,
// treasury/holders via lib/solana.ts + lib/queries.ts, the agent log from the
// live runtime — so the simulation helpers were removed. What remains are the
// shared types describing the launch server action's input/output (lib/actions.ts).
// ─────────────────────────────────────────────────────────────────────────────

import type { Launchpad, Network } from "./types";

// --- Project launch ---------------------------------------------------------
// The launch itself runs as a server action in `lib/actions.ts`. These shared
// types describe its input/output.
export interface LaunchInput {
  name: string;
  ticker: string;
  prompt: string;
  repo?: string;
  /** Cluster to launch on; defaults to the server's LAUNCH_CLUSTER env. */
  network?: Network;
  /** Founder's creator-fee share (0..95); agent gets the rest after platform. */
  feeFounderPct?: number;
  /** Editable guardrails (free text, one per line) the agent rereads each cycle. */
  guardrails?: string;
  /** Content & brand policy the agent applies to everything it publishes. */
  contentPolicy?: string;
  /** Wallet ownership proof (signed launch message); verified server-side. */
  proof?: import("./signature").LaunchProof;
  /**
   * Signature of the on-chain SOL launch-fee payment (creator → platform launch
   * wallet). Required, and verified on-chain, only when pay-to-launch is enabled
   * (lib/launch-fee `launchFeeRequired`); ignored in the untolled prototype.
   */
  paymentSig?: string | null;
  /**
   * Chain to launch on. "solana" (default) mints via the Solana provider;
   * "hood" launches on Pons (Robinhood Chain). Providers are resolved PER CHAIN
   * (lib/launchpad `providerForChain`), so both can be armed at once.
   */
  chain?: import("./chains/types").Chain;
}

export interface LaunchResult {
  /** Project key (slug) — used to link to the new project's page. */
  key: string;
  ticker: string;
  /** Launchpad the token was created on. */
  launchpad?: Launchpad;
  /** SPL mint address for a real launch; null/undefined in simulated mode. */
  mint?: string | null;
  /** Cluster the token launched on. */
  network?: Network;
}
