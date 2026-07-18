import "server-only";

import { unstable_cache } from "next/cache";
import type { Holder } from "./types";
import { creditedBaseUnits, type TokenBalanceEntry } from "./chat";

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

/**
 * The Helius JSON-RPC URL for a cluster (with the server-only key), or null when
 * unconfigured. Used by the `/api/rpc` proxy so the browser wallet adapter can
 * make RPC calls (blockhash, simulate, send, confirm) through OUR server instead
 * of the public `api.mainnet-beta.solana.com` endpoint, which 403s browser reads.
 * Server-only — the returned URL embeds the key, so never send it to the client.
 */
export function heliusRpcUrl(net: Network): string | null {
  return KEY ? endpoint(net) : null;
}

// Public cluster RPC — fallback when Helius is unconfigured or out of credits
// (free-tier "max usage reached" 429s). Reads must degrade to the slower public
// endpoint, not to null balances that wrongly sleep funded agents.
function publicEndpoint(net: Network): string {
  const host = net === "devnet" ? "api.devnet" : "api.mainnet-beta";
  return `https://${host}.solana.com`;
}

// Minimal JSON-RPC helper (same fetch path as getSolBalance). Tries Helius
// first, then the public RPC. Returns the `result` field, or null when every
// endpoint fails. Server-only — never ships the key.
async function rpc<T>(net: Network, method: string, params: unknown): Promise<T | null> {
  const urls = KEY ? [endpoint(net), publicEndpoint(net)] : [publicEndpoint(net)];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) continue;
      const json = await res.json();
      if (json?.error) continue;
      return (json?.result ?? null) as T | null;
    } catch {
      /* try the next endpoint */
    }
  }
  return null;
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

/** Decimals of an SPL mint (e.g. 6 for LOOP), or null on failure. Lets a raw
 * token amount (a Jupiter quote's outAmount) be shown as a human uiAmount. */
export async function getMintDecimals(
  mint: string,
  net: Network = DEFAULT_NETWORK
): Promise<number | null> {
  if (!KEY || !BASE58.test(mint)) return null;
  const res = await rpc<{ value: { decimals: number } }>(net, "getTokenSupply", [mint]);
  return typeof res?.value?.decimals === "number" ? res.value.decimals : null;
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

/** A real on-chain SOL inflow to the treasury — the "money came in" events. */
export interface TreasuryInflow {
  /** Transaction signature (explorer link). */
  sig: string;
  /** SOL credited to the treasury in this tx (always > 0). */
  sol: number;
  /** Unix seconds. */
  at: number;
  /** Helius-classified source, e.g. "PUMP_FUN" / "SYSTEM_PROGRAM" (best-effort). */
  source: string;
}

const inflowsMemo = new Map<string, { at: number; v: TreasuryInflow[] | null }>();

/**
 * Recent SOL INFLOWS to a treasury wallet, newest first — the real "money came
 * in" events: pump.fun creator-fee claims, trade-fee routes, donations. Reads the
 * same Helius enriched-tx endpoint as the balance history and keeps only txs that
 * net-credited the owner (positive nativeBalanceChange). This is what surfaces a
 * founder's pump.fun claim that lands in the treasury/creator wallet. null on
 * unconfigured/invalid/failed (the caller keeps the prior value). Memoized for a
 * short TTL so the force-dynamic landing doesn't hammer the enhanced API.
 */
export async function getRecentTreasuryInflows(
  owner: string,
  net: Network = DEFAULT_NETWORK,
  limit = 6
): Promise<TreasuryInflow[] | null> {
  if (!KEY || !BASE58.test(owner)) return null;
  const memoKey = `${net}:${owner}:${limit}`;
  const hit = inflowsMemo.get(memoKey);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.v;

  const host = net === "devnet" ? "api-devnet.helius.xyz" : "api.helius.xyz";
  // Over-fetch a window (outflows/dust drop out) to still fill `limit` inflows.
  const window = Math.min(100, Math.max(limit * 6, 24));
  let txs: {
    signature?: string;
    timestamp?: number;
    source?: string;
    accountData?: { account: string; nativeBalanceChange: number }[];
  }[];
  try {
    const res = await fetch(
      `https://${host}/v0/addresses/${owner}/transactions?api-key=${KEY}&limit=${window}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    txs = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(txs)) return null;

  const inflows: TreasuryInflow[] = [];
  for (const tx of txs) {
    const delta = tx.accountData?.find((a) => a.account === owner)?.nativeBalanceChange ?? 0;
    // Ignore tiny dust (rent/fees noise); only real credits count as inflows.
    if (delta > 10_000 && typeof tx.timestamp === "number") {
      inflows.push({
        sig: tx.signature ?? "",
        sol: delta / LAMPORTS_PER_SOL,
        at: tx.timestamp,
        source: tx.source ?? "",
      });
      if (inflows.length >= limit) break;
    }
  }
  inflowsMemo.set(memoKey, { at: Date.now(), v: inflows });
  return inflows;
}

/** A pre-launch contribution: a SOL transfer INTO a project wallet, WITH the
 *  sender — what the refund ledger needs (TreasuryInflow omits the payer). */
export interface SolContribution {
  sig: string;
  /** The payer wallet (refund destination). */
  from: string;
  /** SOL credited to the project wallet in this tx (> 0). */
  sol: number;
  /** Unix seconds. */
  at: number;
}

/**
 * Recent SOL transfers INTO `owner` with their sender — the pre-launch "vote with
 * SOL" deposits. Reads the Helius enriched-tx endpoint and, per tx, sums the
 * nativeTransfers landing on `owner` and attributes the largest external sender as
 * the payer (ignoring self-transfers / change). newest first. null on
 * unconfigured/invalid/failed (caller keeps prior state).
 */
export async function getRecentContributions(
  owner: string,
  net: Network = DEFAULT_NETWORK,
  limit = 100
): Promise<SolContribution[] | null> {
  if (!KEY || !BASE58.test(owner)) return null;
  const host = net === "devnet" ? "api-devnet.helius.xyz" : "api.helius.xyz";
  const window = Math.min(100, Math.max(limit, 24));
  let txs: {
    signature?: string;
    timestamp?: number;
    nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[];
  }[];
  try {
    const res = await fetch(
      `https://${host}/v0/addresses/${owner}/transactions?api-key=${KEY}&limit=${window}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    txs = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(txs)) return null;

  const out: SolContribution[] = [];
  for (const tx of txs) {
    if (typeof tx.timestamp !== "number") continue;
    const incoming = (tx.nativeTransfers ?? []).filter(
      (t) => t.toUserAccount === owner && (t.amount ?? 0) > 0 && t.fromUserAccount && t.fromUserAccount !== owner
    );
    if (!incoming.length) continue;
    const totalLamports = incoming.reduce((s, t) => s + (t.amount ?? 0), 0);
    const from = incoming.slice().sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0].fromUserAccount as string;
    out.push({ sig: tx.signature ?? "", from, sol: totalLamports / LAMPORTS_PER_SOL, at: tx.timestamp });
    if (out.length >= limit) break;
  }
  return out;
}

/** SOL balance for an address, or null if invalid / every RPC failed. */
export async function getSolBalance(
  address: string,
  net: Network = DEFAULT_NETWORK
): Promise<number | null> {
  if (!BASE58.test(address)) return null;
  const result = await rpc<{ value?: number }>(net, "getBalance", [address]);
  const lamports = result?.value;
  if (typeof lamports !== "number") return null;
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Verify an on-chain SPL payment: how many base units of `mint` a confirmed
 * transaction `signature` credited to `treasury`. Returns the credited amount
 * (> 0) or `null` when the tx is missing, failed, the cluster is unconfigured,
 * or no `mint` was credited to `treasury`. Used to gate paid chat: the server
 * trusts this, never the client's claimed amount.
 *
 * RPC propagation can lag a beat behind confirmation, so it retries briefly.
 */
export async function verifyTokenPayment(
  signature: string,
  opts: { mint: string; treasury: string; net?: Network }
): Promise<bigint | null> {
  const net = opts.net ?? DEFAULT_NETWORK;
  if (!KEY || !signature || signature.length > 128) return null;
  if (!BASE58.test(opts.mint) || !BASE58.test(opts.treasury)) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const tx = await rpc<{
      meta: {
        err: unknown;
        preTokenBalances?: TokenBalanceEntry[];
        postTokenBalances?: TokenBalanceEntry[];
      } | null;
    }>(net, "getTransaction", [
      signature,
      { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    ]);
    const meta = tx?.meta;
    if (meta) {
      if (meta.err) return null; // the transaction failed — no payment
      const credited = creditedBaseUnits(
        meta.preTokenBalances,
        meta.postTokenBalances,
        opts.mint,
        opts.treasury
      );
      return credited > BigInt(0) ? credited : null;
    }
    // tx not visible yet (propagation lag) — brief backoff, then retry.
    if (attempt < 2) await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

/**
 * Pure: how many lamports a transaction's native-balance deltas credited to the
 * `to` account. `accountKeys`/`preBalances`/`postBalances` come index-aligned
 * from a jsonParsed getTransaction. Returns the positive delta on `to`, or 0n
 * when the account isn't present or didn't gain. No I/O — unit-testable.
 */
export function lamportsCredited(
  accountKeys: { pubkey: string }[] | undefined,
  preBalances: number[] | undefined,
  postBalances: number[] | undefined,
  to: string
): bigint {
  if (!accountKeys || !preBalances || !postBalances) return BigInt(0);
  const i = accountKeys.findIndex((a) => a?.pubkey === to);
  if (i < 0 || i >= preBalances.length || i >= postBalances.length) return BigInt(0);
  const delta = BigInt(postBalances[i] ?? 0) - BigInt(preBalances[i] ?? 0);
  return delta > BigInt(0) ? delta : BigInt(0);
}

/**
 * Verify an on-chain SOL payment: that a confirmed transaction `signature`
 * transferred at least `minLamports` from `from` (who must have SIGNED it) to
 * `to`. Returns the lamports credited (≥ minLamports) or `null` when the tx is
 * missing, failed, unsigned by `from`, underpaid, or the cluster is unconfigured.
 * Used to gate pay-to-launch — the server trusts this, never the client's word.
 *
 * RPC propagation can lag confirmation, so it retries briefly (same as the SPL
 * verifier above).
 */
export async function verifySolPayment(
  signature: string,
  opts: { from: string; to: string; minLamports: bigint; net?: Network }
): Promise<bigint | null> {
  const net = opts.net ?? DEFAULT_NETWORK;
  if (!KEY || !signature || signature.length > 128) return null;
  if (!BASE58.test(opts.from) || !BASE58.test(opts.to)) return null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const tx = await rpc<{
      meta: { err: unknown; preBalances?: number[]; postBalances?: number[] } | null;
      transaction: { message: { accountKeys?: { pubkey: string; signer?: boolean }[] } } | null;
    }>(net, "getTransaction", [
      signature,
      { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    ]);
    const meta = tx?.meta;
    if (meta) {
      if (meta.err) return null; // the transaction failed — no payment
      const keys = tx?.transaction?.message?.accountKeys;
      // The payer must have signed the tx — otherwise it's someone else's payment
      // we'd be crediting to this creator.
      const signedByFrom = (keys ?? []).some((k) => k?.pubkey === opts.from && k?.signer);
      if (!signedByFrom) return null;
      const credited = lamportsCredited(keys, meta.preBalances, meta.postBalances, opts.to);
      return credited >= opts.minLamports && credited > BigInt(0) ? credited : null;
    }
    // tx not visible yet (propagation lag) — brief backoff, then retry.
    if (attempt < 2) await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

/**
 * Verify an on-chain SPL-token payment: that `signature` is a confirmed tx, signed
 * by `from`, that credited `to` at least `minUiAmount` of `mint`. Reads the
 * jsonParsed token-balance deltas (post − pre for the to/mint pair). Returns the
 * UI amount credited on success, or null (failed / not enough / not signed by the
 * payer / not visible). Used by the pre-launch gate (the 1,000,000 $LOOP leg).
 */
export async function verifySplPayment(
  signature: string,
  opts: { from: string; to: string; mint: string; minUiAmount: number; net?: Network }
): Promise<number | null> {
  const net = opts.net ?? DEFAULT_NETWORK;
  if (!KEY || !signature || signature.length > 128) return null;
  if (!BASE58.test(opts.from) || !BASE58.test(opts.to) || !BASE58.test(opts.mint)) return null;
  if (!(opts.minUiAmount > 0)) return null;

  type TokenBal = { mint?: string; owner?: string; uiTokenAmount?: { uiAmount?: number | null } };
  for (let attempt = 0; attempt < 3; attempt++) {
    const tx = await rpc<{
      meta: { err: unknown; preTokenBalances?: TokenBal[]; postTokenBalances?: TokenBal[] } | null;
      transaction: { message: { accountKeys?: { pubkey: string; signer?: boolean }[] } } | null;
    }>(net, "getTransaction", [
      signature,
      { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    ]);
    const meta = tx?.meta;
    if (meta) {
      if (meta.err) return null; // the transaction failed — no payment
      const keys = tx?.transaction?.message?.accountKeys;
      const signedByFrom = (keys ?? []).some((k) => k?.pubkey === opts.from && k?.signer);
      if (!signedByFrom) return null;
      const owned = (b: TokenBal) => b.owner === opts.to && b.mint === opts.mint;
      const amt = (bals?: TokenBal[]) => bals?.find(owned)?.uiTokenAmount?.uiAmount ?? 0;
      const credited = (amt(meta.postTokenBalances) ?? 0) - (amt(meta.preTokenBalances) ?? 0);
      return credited >= opts.minUiAmount && credited > 0 ? credited : null;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

// ── Short-TTL cached reads (cost control) ────────────────────────────────────
// Project pages are force-dynamic and fan out many Helius reads per render; under
// traffic that burns the (paid, rate-limited) Helius quota. These wrap the
// PROJECT-level reads in the Next data cache with a short TTL — repeated reads of
// the same treasury/holders/supply within the window collapse to one upstream
// call, with no perceptible loss of "live". The raw functions above stay
// uncached for correctness-sensitive callers that must read fresh: the user's own
// wallet balance (/api/wallet-balance, Sell·Max) and on-chain payment verification
// (lib/actions launch fee). Tunable via CHAIN_CACHE_TTL_S (seconds).
const CHAIN_TTL = Math.max(0, parseInt(process.env.CHAIN_CACHE_TTL_S || "20", 10)) || 20;
const cacheOpts = { revalidate: CHAIN_TTL } as const;

export const getTopHoldersCached = unstable_cache(getTopHolders, ["solana:top-holders"], cacheOpts);
export const getHolderCountCached = unstable_cache(getHolderCount, ["solana:holder-count"], cacheOpts);
export const getTokenSupplyUiCached = unstable_cache(getTokenSupplyUi, ["solana:token-supply"], cacheOpts);
export const getTreasuryHistoryCached = unstable_cache(getTreasuryHistory, ["solana:treasury-history"], cacheOpts);
/** Cached treasury/agent SOL balance — NOT for the user's own wallet (use raw). */
export const getSolBalanceCached = unstable_cache(getSolBalance, ["solana:sol-balance"], cacheOpts);
/** Cached treasury/holdings token balance — NOT for the user's own wallet (use raw). */
export const getSplBalanceCached = unstable_cache(getSplBalance, ["solana:spl-balance"], cacheOpts);
