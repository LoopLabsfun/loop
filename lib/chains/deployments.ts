// ─────────────────────────────────────────────────────────────────────────────
// ONE PROJECT, N CHAIN DEPLOYMENTS.
//
// A project is ONE thing — one slug, one agent, one backlog, one repo. What
// differs per chain is only the MARKET side: the token, the treasury, the agent
// wallet, the native balances. $LOOP funded on Hood extends the same agent's
// runway as $LOOP funded on Solana; it is a second funding source, not a second
// project. (The earlier design gave Hood its own `loop-hood` project row, which
// meant two agents ticking on the same repo and duplicating Claude spend.)
//
// The trick that makes this cheap: the codebase reads `p.mint`,
// `p.treasuryWallet`, `p.agentWallet`, `p.treasurySol` in 100+ places. Rather
// than rewrite them, `projectOnChain(p, chain)` FLATTENS the requested chain's
// deployment onto exactly those fields and returns a normal `Project`. Callers
// keep reading flat fields; this seam decides which chain they describe —
// the same overlay shape as `withLiveBalances()` in lib/queries.ts.
//
// Pure + dependency-free: importable from Client and Server Components alike,
// and unit-testable without a database.
// ─────────────────────────────────────────────────────────────────────────────

import type { Launchpad, Network, Project } from "../types";
import type { Chain } from "./types";

/** A project's presence on one chain. Mirrors a `project_chains` row. */
export interface ChainDeployment {
  chain: Chain;
  mint: string | null;
  treasuryWallet: string | null;
  agentWallet: string | null;
  /** Treasury in NATIVE units of this chain (SOL or ETH). */
  treasuryNative: number;
  earnedNative: number;
  launchpad: Launchpad | null;
  /** Solana cluster; always "mainnet" on Hood. */
  network: Network;
}

/** The chain a project calls home — where it launched. Falls back to "solana"
 *  for rows that predate the chain column. */
export function homeChain(p: Project): Chain {
  return p.chain ?? "solana";
}

/**
 * The project's home deployment, synthesized from the flat `projects` columns.
 * Every project has one even before `project_chains` is populated, which is what
 * keeps single-chain projects working untouched.
 */
export function homeDeployment(p: Project): ChainDeployment {
  return {
    chain: homeChain(p),
    mint: p.mint ?? null,
    treasuryWallet: p.treasuryWallet ?? null,
    agentWallet: p.agentWallet ?? null,
    treasuryNative: p.treasurySol ?? 0,
    earnedNative: p.earnedSol ?? 0,
    launchpad: p.launchpad ?? null,
    network: p.network ?? "mainnet",
  };
}

/** Every deployment of a project, home first, de-duplicated by chain. */
export function deploymentsOf(p: Project): ChainDeployment[] {
  const home = homeDeployment(p);
  const rest = (p.deployments ?? []).filter((d) => d.chain !== home.chain);
  return [home, ...rest];
}

/** The chains a project is actually live on (home first). */
export function chainsOf(p: Project): Chain[] {
  return deploymentsOf(p).map((d) => d.chain);
}

/** The project's deployment on `chain`, or null if it isn't live there. */
export function deploymentOn(p: Project, chain: Chain): ChainDeployment | null {
  return deploymentsOf(p).find((d) => d.chain === chain) ?? null;
}

/** True when the project can be traded/funded on `chain`. */
export function isLiveOn(p: Project, chain: Chain): boolean {
  return deploymentOn(p, chain) !== null;
}

/** True when a project spans more than one chain — the case the token page's
 *  chain switch is FOR (same slug, same feed, different market). */
export function isMultichain(p: Project): boolean {
  return deploymentsOf(p).length > 1;
}

/**
 * Return the project as seen from `chain`: identity untouched, market side
 * (token, treasury, agent wallet, native balances, launchpad, cluster) swapped
 * to that chain's deployment. Returns the project UNCHANGED when it has no
 * deployment there — callers decide how to render that (the token page shows a
 * "coming to X" panel rather than someone else's market data).
 *
 * Live-read overlays (`treasuryLive`, `treasuryTokenUi`, `treasuryHistory`) are
 * dropped when the chain actually changes: they were read against the home
 * chain's treasury and would be a lie about the other one.
 */
export function projectOnChain(p: Project, chain: Chain): Project {
  const d = deploymentOn(p, chain);
  if (!d || d.chain === homeChain(p)) return p;
  const next: Project = {
    ...p,
    chain: d.chain,
    mint: d.mint,
    treasuryWallet: d.treasuryWallet,
    agentWallet: d.agentWallet,
    treasurySol: d.treasuryNative,
    earnedSol: d.earnedNative,
    network: d.network,
  };
  if (d.launchpad) next.launchpad = d.launchpad;
  delete next.treasuryLive;
  delete next.treasuryTokenUi;
  delete next.treasuryHistory;
  return next;
}
