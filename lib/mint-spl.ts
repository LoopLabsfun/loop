import "server-only";

import type { LaunchCluster } from "./launchpad";

// Mint a real SPL token directly (no third-party launchpad). The heavy Solana
// libraries are imported *dynamically* so they never enter Next's static server
// bundle — @solana/web3.js is an ESM/CJS hybrid that breaks server bundling when
// required statically (see lib/solana.ts). This module is only reached when
// LAUNCHPAD_PROVIDER=spl, so the default prototype path never loads it.
//
// The signer (LAUNCH_SIGNER_SECRET) pays for and owns the new mint; its pubkey
// doubles as the project's treasury wallet for now. On devnet, fund it from the
// faucet; on mainnet it must hold real SOL. Secret has no NEXT_PUBLIC_ prefix.

export interface SplMintResult {
  mint: string;
  treasuryWallet: string;
  txSig: string | null;
}

/** Helius when configured, else the public cluster endpoint. */
function rpcEndpoint(cluster: LaunchCluster): string {
  const key = process.env.HELIUS_API_KEY;
  const host = cluster === "devnet" ? "devnet" : "mainnet";
  if (key) return `https://${host}.helius-rpc.com/?api-key=${key}`;
  return cluster === "devnet"
    ? "https://api.devnet.solana.com"
    : "https://api.mainnet-beta.solana.com";
}

/** Parse the LAUNCH_SIGNER_SECRET (a JSON array of the 64-byte secret key). */
export function parseSecretKey(raw: string): Uint8Array {
  let arr: unknown;
  try {
    arr = JSON.parse(raw.trim());
  } catch {
    throw new Error(
      "LAUNCH_SIGNER_SECRET must be a JSON array of the 64-byte secret key (solana-keygen format)."
    );
  }
  if (!Array.isArray(arr) || arr.length !== 64) {
    throw new Error(
      "LAUNCH_SIGNER_SECRET must be a 64-element JSON array (the solana-keygen secret key)."
    );
  }
  return Uint8Array.from(arr as number[]);
}

export async function mintSplToken(
  cluster: LaunchCluster,
  decimals = 9
): Promise<SplMintResult> {
  const secret = process.env.LAUNCH_SIGNER_SECRET;
  if (!secret) {
    throw new Error(
      "SPL launch is selected but LAUNCH_SIGNER_SECRET is not set."
    );
  }

  const { Connection, Keypair } = await import("@solana/web3.js");
  const { createMint } = await import("@solana/spl-token");

  const signer = Keypair.fromSecretKey(parseSecretKey(secret));
  const conn = new Connection(rpcEndpoint(cluster), "confirmed");

  // Vanity mint address (e.g. ends in "Loop"), drawn from a pre-ground pool
  // (VANITY_POOL). When MINT_VANITY_SUFFIX is set the guarantee is strict:
  // every minted address ends in the suffix, or the launch FAILS — we never
  // fall back to a non-matching random address. (Random is used only when no
  // suffix is configured at all.)
  const suffix = process.env.MINT_VANITY_SUFFIX;
  let mintKeypair: import("@solana/web3.js").Keypair | undefined;
  if (suffix) {
    const { nextVanityKeypair } = await import("./vanity");
    const vanity = await nextVanityKeypair(suffix, cluster);
    if (!vanity) {
      throw new Error(
        `Vanity mint pool for "${suffix}" is empty — refusing to mint a ` +
          `non-"${suffix}" address. Replenish VANITY_POOL and retry.`
      );
    }
    mintKeypair = vanity;
  }

  // createMint funds rent from `signer`; it must already hold SOL on `cluster`.
  const mint = await createMint(
    conn,
    signer,
    signer.publicKey, // mint authority
    signer.publicKey, // freeze authority
    decimals,
    mintKeypair // undefined ⇒ random mint address
  );

  return {
    mint: mint.toBase58(),
    treasuryWallet: signer.publicKey.toBase58(),
    txSig: null, // createMint returns the mint address, not the signature
  };
}
