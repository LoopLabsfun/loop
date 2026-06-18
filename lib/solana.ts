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

// Live phase: server reads default to mainnet unless SOLANA_NETWORK is explicitly
// "devnet". Per-project `network` columns still override per project.
export const DEFAULT_NETWORK: Network =
  process.env.SOLANA_NETWORK === "devnet" ? "devnet" : "mainnet";

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

/** One point on the treasury balance trajectory: unix seconds + SOL balance. */
export interface BalancePoint {
  t: number;
  sol: number;
}

// Bound the Helius enhanced-API usage on the force-dynamic landing: the history
// barely moves between renders, so memoize per (net, owner) for a short TTL.
const HISTORY_TTL_MS = 60_000;
const historyMemo = new Map<string, { at: number; v: BalancePoint[] | null }>();

/**
 * Real on-chain SOL-balance trajectory of `owner`, oldest→newest, reconstructed
 * from the live balance walked back through Helius's parsed transaction history
 * (each tx's `nativeBalanceChange`). Every value is a real on-chain SOL amount;
 * points are spaced by event, not by clock. null on unconfigured/invalid/failed.
 * Powers the treasury sparkline without needing a stored history table.
 */
export async function getTreasuryHistory(
  owner: string,
  net: Network = DEFAULT_NETWORK,
  opts: { limit?: number; knownLamports?: number } = {}
): Promise<BalancePoint[] | null> {
  if (!KEY || !BASE58.test(owner)) return null;
  const limit = opts.limit ?? 50;
  const memoKey = `${net}:${owner}:${limit}`;
  const hit = historyMemo.get(memoKey);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.v;

  const v = await fetchTreasuryHistory(owner, net, limit, opts.knownLamports);
  // Cache only successful reads, so a transient failure retries next call.
  if (v !== null) historyMemo.set(memoKey, { at: Date.now(), v });
  return v;
}

async function fetchTreasuryHistory(
  owner: string,
  net: Network,
  limit: number,
  knownLamports?: number
): Promise<BalancePoint[] | null> {
  // Anchor: the current balance, walked backwards through the deltas. Reuse the
  // caller's balance read when given (one fewer Helius call, and the curve ends
  // on exactly the SOL the headline shows); otherwise fetch it.
  let current = knownLamports;
  if (typeof current !== "number") {
    const balRes = await rpc<{ value: number }>(net, "getBalance", [owner]);
    current = balRes?.value;
  }
  if (typeof current !== "number") return null;

  const host = net === "devnet" ? "api-devnet.helius.xyz" : "api.helius.xyz";
  let txs: {
    timestamp: number;
    accountData?: { account: string; nativeBalanceChange: number }[];
  }[];
  try {
    const res = await fetch(
      `https://${host}/v0/addresses/${owner}/transactions?api-key=${KEY}&limit=${limit}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    txs = await res.json();
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!Array.isArray(txs) || txs.length === 0) {
    return [{ t: now, sol: current / LAMPORTS_PER_SOL }];
  }

  // Walk newest→oldest: `running` is the balance AFTER each tx (starting from the
  // live balance ≈ after the newest tx). Subtracting a tx's own delta yields the
  // level before it == the level after the next older tx.
  const deltaFor = (tx: (typeof txs)[number]) =>
    tx.accountData?.find((a) => a.account === owner)?.nativeBalanceChange ?? 0;
  const points: BalancePoint[] = [];
  let running = current;
  for (const tx of txs) {
    if (typeof tx.timestamp === "number") {
      points.push({ t: tx.timestamp, sol: running / LAMPORTS_PER_SOL });
    }
    running -= deltaFor(tx);
  }
  // Left anchor: the balance just before the oldest fetched tx (clamped ≥ 0).
  const oldest = txs[txs.length - 1];
  if (typeof oldest?.timestamp === "number") {
    points.push({ t: oldest.timestamp - 1, sol: Math.max(0, running) / LAMPORTS_PER_SOL });
  }
  points.reverse(); // chronological
  points.push({ t: now, sol: current / LAMPORTS_PER_SOL }); // end at the live balance
  return points;
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
