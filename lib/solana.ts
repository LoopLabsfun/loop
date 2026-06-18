import "server-only";

import type { Holder } from "./types";

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

// Devnet-first phase: server reads default to devnet unless SOLANA_NETWORK is
// explicitly "mainnet". Per-project `network` columns still override per project.
export const DEFAULT_NETWORK: Network =
  process.env.SOLANA_NETWORK === "mainnet" ? "mainnet" : "devnet";

const LAMPORTS_PER_SOL = 1_000_000_000;
// Base58 pubkey shape (no 0, O, I, l), 32–44 chars.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function endpoint(net: Network): string {
  const host = net === "devnet" ? "devnet" : "mainnet";
  return `https://${host}.helius-rpc.com/?api-key=${KEY}`;
}

// Minimal JSON-RPC helper (same fetch path as getSolBalance). Returns the
// `result` field, or null on any failure. Server-only — never ships the key.
async function rpc<T>(net: Network, method: string, params: unknown): Promise<T | null> {
  if (!KEY) return null;
  try {
    const res = await fetch(endpoint(net), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.result ?? null) as T | null;
  } catch {
    return null;
  }
}

/**
 * Top token holders for a mint (owner wallets + share of supply, 0..1), or []
 * on failure. Uses getTokenLargestAccounts (top 20 token accounts) → resolves
 * each token account's owner via getMultipleAccounts (jsonParsed) → divides by
 * total supply. Best-effort: any missing piece drops that holder.
 */
export async function getTopHolders(
  mint: string,
  net: Network = DEFAULT_NETWORK,
  n = 10
): Promise<Holder[]> {
  if (!KEY || !BASE58.test(mint)) return [];

  const [largest, supply] = await Promise.all([
    rpc<{ value: { address: string; uiAmount: number | null }[] }>(
      net,
      "getTokenLargestAccounts",
      [mint]
    ),
    rpc<{ value: { uiAmount: number | null } }>(net, "getTokenSupply", [mint]),
  ]);

  const accounts = largest?.value ?? [];
  const total = supply?.value?.uiAmount ?? 0;
  if (!accounts.length || !total) return [];

  const top = accounts.slice(0, n);
  const owners = await rpc<{
    value: ({ data?: { parsed?: { info?: { owner?: string } } } } | null)[];
  }>(net, "getMultipleAccounts", [top.map((a) => a.address), { encoding: "jsonParsed" }]);

  return top
    .map((a, i) => {
      const owner = owners?.value?.[i]?.data?.parsed?.info?.owner ?? a.address;
      const amount = a.uiAmount ?? 0;
      return { address: owner, share: amount / total } satisfies Holder;
    })
    .filter((h) => h.share > 0);
}

/**
 * Holder count for a mint, or null on failure. Uses Helius DAS
 * `getTokenAccounts`, paginating (1000/page) up to `maxPages`. Returns
 * `{ count, capped }` — `capped` true when the page cap was hit (show "N+").
 */
export async function getHolderCount(
  mint: string,
  net: Network = DEFAULT_NETWORK,
  maxPages = 10
): Promise<{ count: number; capped: boolean } | null> {
  if (!KEY || !BASE58.test(mint)) return null;
  const limit = 1000;
  let count = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await rpc<{ token_accounts?: { amount?: number | string }[] }>(
      net,
      "getTokenAccounts",
      { mint, page, limit, options: { showZeroBalance: false } }
    );
    const rows = res?.token_accounts ?? [];
    if (page === 1 && !rows.length && res === null) return null;
    count += rows.length;
    if (rows.length < limit) return { count, capped: false };
  }
  return { count, capped: true };
}

/** Circulating token supply (uiAmount) for a mint, or null on failure. */
export async function getTokenSupplyUi(
  mint: string,
  net: Network = DEFAULT_NETWORK
): Promise<number | null> {
  if (!KEY || !BASE58.test(mint)) return null;
  const res = await rpc<{ value: { uiAmount: number | null } }>(net, "getTokenSupply", [mint]);
  return res?.value?.uiAmount ?? null;
}

/**
 * SPL token balance (uiAmount) that `owner` holds of `mint`, summed across its
 * token accounts — or null if unconfigured / invalid / failed (0 when it holds
 * none). Lets the treasury be valued by the project's OWN token too, not just
 * the SOL it holds.
 */
export async function getSplBalance(
  owner: string,
  mint: string,
  net: Network = DEFAULT_NETWORK
): Promise<number | null> {
  if (!KEY || !BASE58.test(owner) || !BASE58.test(mint)) return null;
  const res = await rpc<{
    value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[];
  }>(net, "getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);
  if (!res?.value) return null;
  let total = 0;
  for (const a of res.value) {
    const ui = a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
    if (typeof ui === "number") total += ui;
  }
  return total;
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
