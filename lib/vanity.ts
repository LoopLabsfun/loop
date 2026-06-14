import "server-only";

import type { LaunchCluster } from "./launchpad";

// Vanity mint addresses. Grinding a keypair whose pubkey ends in a suffix like
// "Loop" costs ~40s of CPU each, and solana-keygen isn't available in the
// serverless runtime — so we pre-grind a pool offline and pass it in via the
// VANITY_POOL env (a JSON array of 64-byte secret-key arrays, solana-keygen
// format). At mint time we pick the first pool keypair that (a) ends in the
// suffix and (b) has no account on-chain yet — i.e. hasn't been used as a mint.
// The chain itself tracks consumption, so no DB and it's idempotent on retry.
//
// Server-only: secret keys never reach the browser. Mint keypairs are inert
// after createMint (no authority, hold no funds), but we still keep them server-side.

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

function rpcEndpoint(cluster: LaunchCluster): string {
  const key = process.env.HELIUS_API_KEY;
  const host = cluster === "devnet" ? "devnet" : "mainnet";
  if (key) return `https://${host}.helius-rpc.com/?api-key=${key}`;
  return cluster === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
}

/**
 * Pick an unused pool keypair ending in `suffix` for `cluster`, or null when
 * vanity isn't configured / the pool is empty / all matching keys are spent.
 * When a suffix is configured the caller treats null as a hard failure (it will
 * not mint a non-matching address), so the suffix guarantee always holds.
 */
export async function nextVanityKeypair(
  suffix: string,
  cluster: LaunchCluster
): Promise<import("@solana/web3.js").Keypair | null> {
  const pool = parseVanityPool(process.env.VANITY_POOL);
  if (!suffix || pool.length === 0) return null;

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
    // No account yet ⇒ this mint address is unused.
    const info = await conn.getAccountInfo(kp.publicKey);
    if (info === null) return kp;
  }
  return null;
}
