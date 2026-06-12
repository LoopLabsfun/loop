import "server-only";

// Server-only Solana access via Helius. The API key lives in HELIUS_API_KEY
// (no NEXT_PUBLIC prefix) so it never reaches the browser.
//
// We talk to the RPC over plain fetch (JSON-RPC) rather than @solana/web3.js:
// that package is an ESM/CJS hybrid that breaks Next's server bundling
// (vendor-chunk build error) or the Vercel lambda runtime (ERR_REQUIRE_ESM).
// fetch keeps the server path dependency-free; @solana/web3.js stays a
// client-only dep for the wallet adapter.

export type Network = "mainnet" | "devnet";

const KEY = process.env.HELIUS_API_KEY;
export const heliusConfigured = Boolean(KEY);

export const DEFAULT_NETWORK: Network =
  process.env.SOLANA_NETWORK === "devnet" ? "devnet" : "mainnet";

const LAMPORTS_PER_SOL = 1_000_000_000;
// Base58 pubkey shape (no 0, O, I, l), 32–44 chars.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function endpoint(net: Network): string {
  const host = net === "devnet" ? "devnet" : "mainnet";
  return `https://${host}.helius-rpc.com/?api-key=${KEY}`;
}

/** SOL balance for an address, or null if unconfigured / invalid / failed. */
export async function getSolBalance(
  address: string,
  net: Network = DEFAULT_NETWORK
): Promise<number | null> {
  if (!KEY || !BASE58.test(address)) return null;
  try {
    const res = await fetch(endpoint(net), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const lamports = json?.result?.value;
    if (typeof lamports !== "number") return null;
    return lamports / LAMPORTS_PER_SOL;
  } catch {
    return null;
  }
}
