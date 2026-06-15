import "server-only";

import type { LaunchCluster } from "./launchpad";
import { supabaseAdmin } from "./supabase";

// Vanity mint addresses (e.g. every CA ends in "Loop"). Grinding a keypair whose
// pubkey ends in a 4-char suffix is ~11M tries — far too slow to do per launch,
// and solana-keygen isn't in the serverless runtime. So we PRE-GRIND a pool
// offline (CPU now, GPU later) and hand one out per launch in O(1). Two sources,
// tried in order:
//
//   1. DB pool (scalable): the `vanity_keypairs` table + `claim_vanity_keypair`
//      RPC (FOR UPDATE SKIP LOCKED) atomically hand out one unused keypair —
//      concurrency-safe and unbounded. Used when SUPABASE_SERVICE_ROLE_KEY is set.
//   2. Env pool (fallback): VANITY_POOL, a JSON array of 64-byte secret keys.
//
// When a suffix is configured the caller treats a null result as a HARD FAILURE
// (it never mints a non-matching address), so the "…Loop" guarantee always holds.
//
// Server-only: secret keys never reach the browser. Mint keypairs are inert after
// createMint (no authority, hold no funds), but we keep them server-side anyway.

/** Pure: parse VANITY_POOL into a list of 64-byte secret-key arrays. */
export function parseVanityPool(raw: string | undefined): number[][] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (k): k is number[] =>
        Array.isArray(k) && k.length === 64 && k.every((n) => typeof n === "number")
    );
  } catch {
    return [];
  }
}

/** Pure: coerce a claimed secret_key (jsonb) into a 64-byte array, or null. */
export function parseSecretKeyJson(value: unknown): number[] | null {
  const arr = typeof value === "string" ? safeJson(value) : value;
  if (Array.isArray(arr) && arr.length === 64 && arr.every((n) => typeof n === "number")) {
    return arr as number[];
  }
  return null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function rpcEndpoint(cluster: LaunchCluster): string {
  const key = process.env.HELIUS_API_KEY;
  const host = cluster === "devnet" ? "devnet" : "mainnet";
  if (key) return `https://${host}.helius-rpc.com/?api-key=${key}`;
  return cluster === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
}

/** Atomically claim one unused keypair from the DB pool, or null. */
async function claimFromDb(
  suffix: string
): Promise<import("@solana/web3.js").Keypair | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.rpc("claim_vanity_keypair", {
    p_suffix: suffix,
  });
  if (error || !data) return null;
  const secret = parseSecretKeyJson(data);
  if (!secret) return null;
  const { Keypair } = await import("@solana/web3.js");
  try {
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  } catch {
    return null;
  }
}

/** Pick an unused env-pool keypair ending in `suffix` that's unused on-chain. */
async function claimFromEnv(
  suffix: string,
  cluster: LaunchCluster
): Promise<import("@solana/web3.js").Keypair | null> {
  const pool = parseVanityPool(process.env.VANITY_POOL);
  if (pool.length === 0) return null;
  const { Keypair, Connection } = await import("@solana/web3.js");
  const conn = new Connection(rpcEndpoint(cluster), "confirmed");
  for (const secret of pool) {
    let kp: import("@solana/web3.js").Keypair;
    try {
      kp = Keypair.fromSecretKey(Uint8Array.from(secret));
    } catch {
      continue;
    }
    if (!kp.publicKey.toBase58().endsWith(suffix)) continue;
    const info = await conn.getAccountInfo(kp.publicKey); // null ⇒ unused
    if (info === null) return kp;
  }
  return null;
}

/**
 * Hand out an unused keypair ending in `suffix`, preferring the scalable DB pool
 * and falling back to the env pool. Returns null when none is available — the
 * caller then refuses to mint (preserving the suffix guarantee).
 */
export async function nextVanityKeypair(
  suffix: string,
  cluster: LaunchCluster
): Promise<import("@solana/web3.js").Keypair | null> {
  if (!suffix) return null;
  return (await claimFromDb(suffix)) ?? (await claimFromEnv(suffix, cluster));
}
