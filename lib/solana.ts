import "server-only";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

// Server-only Solana access via Helius. The API key lives in HELIUS_API_KEY
// (no NEXT_PUBLIC prefix) so it never reaches the browser. Importing this file
// from a Client Component will fail the build — intentional.

export type Network = "mainnet" | "devnet";

const KEY = process.env.HELIUS_API_KEY;
export const heliusConfigured = Boolean(KEY);

export const DEFAULT_NETWORK: Network =
  process.env.SOLANA_NETWORK === "devnet" ? "devnet" : "mainnet";

function endpoint(net: Network): string {
  const host = net === "devnet" ? "devnet" : "mainnet";
  return `https://${host}.helius-rpc.com/?api-key=${KEY}`;
}

const cache: Partial<Record<Network, Connection>> = {};

export function getConnection(net: Network = DEFAULT_NETWORK): Connection | null {
  if (!KEY) return null;
  if (!cache[net]) {
    cache[net] = new Connection(endpoint(net), "confirmed");
  }
  return cache[net]!;
}

/** SOL balance for an address, or null if unconfigured / invalid / failed. */
export async function getSolBalance(
  address: string,
  net: Network = DEFAULT_NETWORK
): Promise<number | null> {
  const conn = getConnection(net);
  if (!conn) return null;
  try {
    const lamports = await conn.getBalance(new PublicKey(address));
    return lamports / LAMPORTS_PER_SOL;
  } catch {
    return null;
  }
}
