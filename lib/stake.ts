import type { LaunchCluster } from "./launchpad";

// On-chain LOOP holdings reader.
//
// Pay-to-launch removed the launch stake gate — LOOP is no longer a toll to
// publish. A wallet's LOOP balance now sets its *model boost tier* (hold 1,000 →
// Haiku, 5,000 → Sonnet, 25,000 → Opus) and its platform governance weight.
// This module reads that balance over JSON-RPC (no @solana/web3.js on the server
// path — same reason as lib/solana.ts). Env-gated on LOOP_MINT: when unset
// (prototype mode) the boost threshold is treated as met so the default tier
// applies; when set, the wallet must hold at least the tier amount of that mint.
//
// Server-intended (pairs with HELIUS_API_KEY). Reads env lazily so it stays
// unit-testable; secret env has no NEXT_PUBLIC_ prefix so nothing leaks client-side.

export const STAKE_REQUIRED_LOOP = 1000;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The configured LOOP mint, or null when stake gating is off (prototype). */
export function loopMint(): string | null {
  const m = process.env.LOOP_MINT;
  return m && BASE58.test(m) ? m : null;
}

/** True when a LOOP_MINT is configured, i.e. the holdings tier check is active. */
export function stakeEnforced(): boolean {
  return loopMint() !== null;
}

/** Pure: does `balance` meet the required stake? null = unknown → fails. */
export function meetsStake(
  balance: number | null,
  required = STAKE_REQUIRED_LOOP
): boolean {
  return balance !== null && balance >= required;
}

function endpoint(cluster: LaunchCluster): string {
  const key = process.env.HELIUS_API_KEY;
  const host = cluster === "devnet" ? "devnet" : "mainnet";
  if (key) return `https://${host}.helius-rpc.com/?api-key=${key}`;
  return cluster === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
}

/** Pure: sum uiAmount across a getTokenAccountsByOwner jsonParsed result. */
export function sumLoopBalance(rpcResult: unknown): number {
  const value = (rpcResult as { value?: unknown[] } | undefined)?.value;
  if (!Array.isArray(value)) return 0;
  let total = 0;
  for (const acc of value) {
    const ui = (acc as any)?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
    if (typeof ui === "number") total += ui;
  }
  return total;
}

/**
 * Total LOOP held by `owner` on `cluster`, or null on unconfigured/invalid/
 * failed reads (callers treat null as "couldn't verify").
 */
export async function getLoopBalance(
  owner: string,
  cluster: LaunchCluster
): Promise<number | null> {
  const mint = loopMint();
  if (!mint || !BASE58.test(owner)) return null;
  try {
    const res = await fetch(endpoint(cluster), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { encoding: "jsonParsed" }],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.result) return null;
    return sumLoopBalance(json.result);
  } catch {
    return null;
  }
}

/**
 * Holdings threshold check (e.g. for a boost tier). Met when no LOOP_MINT is
 * configured (prototype). Otherwise the wallet must hold at least the required
 * amount of LOOP. Not a launch gate — launch is pay-to-launch.
 */
export async function hasRequiredStake(
  owner: string | null,
  cluster: LaunchCluster
): Promise<boolean> {
  if (!stakeEnforced()) return true;
  if (!owner) return false;
  return meetsStake(await getLoopBalance(owner, cluster));
}
