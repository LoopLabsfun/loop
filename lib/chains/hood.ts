import "server-only";

import { unstable_cache } from "next/cache";
import { HOOD_DEFAULT_RPC } from "./registry";

// Server-only Hood (Robinhood Chain) access — the EVM counterpart of
// lib/solana.ts. Same design: plain fetch JSON-RPC (no viem/ethers on the
// server, so Next bundling stays dependency-free), null on any failure so
// callers keep their stored snapshot. The public RPC needs no API key;
// HOOD_RPC_URL overrides it (e.g. a keyed provider under load).

const RPC = process.env.HOOD_RPC_URL || HOOD_DEFAULT_RPC;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

// keccak256("balanceOf(address)") first 4 bytes.
const BALANCE_OF_SELECTOR = "0x70a08231";

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(RPC, {
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

/** Parse a hex quantity ("0x…") into UI units for `decimals`, or null on junk.
 *  BigInt → Number loses only sub-double precision — fine for balances. */
export function hexToUi(hex: string, decimals: number): number | null {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex)) return null;
  try {
    return Number(BigInt(hex)) / 10 ** decimals;
  } catch {
    return null;
  }
}

/**
 * Native ETH balance of `address` on Hood in UI units, or null on
 * invalid/failed reads — callers treat null as "keep the snapshot".
 */
export async function getEthBalance(address: string): Promise<number | null> {
  if (!EVM_ADDRESS.test(address)) return null;
  const hex = await rpc<string>("eth_getBalance", [address, "latest"]);
  return hex === null ? null : hexToUi(hex, 18);
}

/**
 * ERC-20 balance of `owner` for `token` in UI units (18 decimals by default —
 * HoodLauncher curve tokens are 18-decimal), or null on failure.
 */
export async function getErc20Balance(
  owner: string,
  token: string,
  decimals = 18
): Promise<number | null> {
  if (!EVM_ADDRESS.test(owner) || !EVM_ADDRESS.test(token)) return null;
  const data =
    BALANCE_OF_SELECTOR + owner.slice(2).toLowerCase().padStart(64, "0");
  const hex = await rpc<string>("eth_call", [{ to: token, data }, "latest"]);
  return hex === null ? null : hexToUi(hex, decimals);
}

// Short-TTL caches, mirroring lib/solana.ts (same knob).
const TTL = Math.max(0, parseInt(process.env.CHAIN_CACHE_TTL_S || "20", 10)) || 20;
const cacheOpts = { revalidate: TTL } as const;

export const getEthBalanceCached = unstable_cache(getEthBalance, ["hood:eth-balance"], cacheOpts);
export const getErc20BalanceCached = unstable_cache(getErc20Balance, ["hood:erc20-balance"], cacheOpts);
