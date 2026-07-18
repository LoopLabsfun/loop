import "server-only";

import { unstable_cache } from "next/cache";
import { HOOD_DEFAULT_RPC } from "./registry";
import {
  CURVE_TOTAL_SUPPLY,
  hoodLauncherAddress,
  SELECTOR,
} from "./hood-abi";

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

// ── HoodLauncher bonding-curve reads ─────────────────────────────────────────

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/** The n-th 32-byte word of ABI-encoded return data (0-indexed), as a 0x-hex
 *  string, or null if the data is too short. */
function word(hex: string, n: number): string | null {
  const start = 2 + n * 64;
  const slice = hex.slice(start, start + 64);
  return slice.length === 64 ? "0x" + slice : null;
}

function wordToBigInt(hex: string, n: number): bigint | null {
  const w = word(hex, n);
  if (!w) return null;
  try {
    return BigInt(w);
  } catch {
    return null;
  }
}

/** Live state of a token's bonding curve on the HoodLauncher, or null when the
 *  token is unknown to the launcher / the read fails. The derived fields use the
 *  SAME x*y=k math as the contract:
 *   - priceEth  = virtualEth / virtualTokens  (marginal ETH per whole token)
 *   - marketCapEth = priceEth × 1B total supply
 *   - progress  = realEth / target            (real fraction toward migration)
 */
export interface CurveState {
  /** Virtual ETH reserve (wei). */
  virtualEth: bigint;
  /** Virtual token reserve (base units, 18 decimals). */
  virtualTokens: bigint;
  /** Real ETH collected so far (wei). */
  realEth: bigint;
  /** Migration threshold (wei). */
  target: bigint;
  feeBps: number;
  migrationBps: number;
  creator: string;
  /** True once migrated to Uniswap v2 (trades then happen on the DEX). */
  migrated: boolean;
  /** Marginal price in ETH per whole token. */
  priceEth: number;
  /** Fully-diluted market cap in ETH (price × 1B supply). */
  marketCapEth: number;
  /** Migration progress 0..1 (realEth / target). */
  progress: number;
}

/**
 * Read a token's curve from the HoodLauncher via `curves(address)`. Requires
 * NEXT_PUBLIC_HOOD_LAUNCHER_ADDRESS to be set (the launcher must be deployed);
 * returns null otherwise, on an unknown token (creator == 0), or on any failure.
 */
export async function getCurveState(token: string): Promise<CurveState | null> {
  const launcher = hoodLauncherAddress();
  if (!EVM_ADDRESS.test(token) || !launcher) return null;
  const data = SELECTOR.curves + token.slice(2).toLowerCase().padStart(64, "0");
  const hex = await rpc<string>("eth_call", [
    { to: launcher, data },
    "latest",
  ]);
  if (!hex || hex.length < 2 + 64 * 8) return null;

  const virtualEth = wordToBigInt(hex, 0);
  const virtualTokens = wordToBigInt(hex, 1);
  const realEth = wordToBigInt(hex, 2);
  const target = wordToBigInt(hex, 3);
  const feeBps = wordToBigInt(hex, 4);
  const migrationBps = wordToBigInt(hex, 5);
  const creatorWord = word(hex, 6);
  const migratedWord = wordToBigInt(hex, 7);
  if (
    virtualEth === null ||
    virtualTokens === null ||
    virtualTokens === BigInt(0) ||
    realEth === null ||
    target === null ||
    feeBps === null ||
    migrationBps === null ||
    creatorWord === null ||
    migratedWord === null
  ) {
    return null;
  }
  // address = low 20 bytes of the word.
  const creator = "0x" + creatorWord.slice(-40);
  if (creator === ZERO_ADDR) return null; // unknown token

  // priceEth is a ratio of two 1e18-scaled integers → ETH per whole token.
  const priceEth = Number(virtualEth) / Number(virtualTokens);
  const marketCapEth = priceEth * CURVE_TOTAL_SUPPLY;
  const progress =
    target > BigInt(0) ? Math.max(0, Math.min(1, Number(realEth) / Number(target))) : 0;

  return {
    virtualEth,
    virtualTokens,
    realEth,
    target,
    feeBps: Number(feeBps),
    migrationBps: Number(migrationBps),
    creator,
    migrated: migratedWord !== BigInt(0),
    priceEth,
    marketCapEth,
    progress,
  };
}

// Short-TTL caches, mirroring lib/solana.ts (same knob).
const TTL = Math.max(0, parseInt(process.env.CHAIN_CACHE_TTL_S || "20", 10)) || 20;
const cacheOpts = { revalidate: TTL } as const;

export const getEthBalanceCached = unstable_cache(getEthBalance, ["hood:eth-balance"], cacheOpts);
export const getErc20BalanceCached = unstable_cache(getErc20Balance, ["hood:erc20-balance"], cacheOpts);
export const getCurveStateCached = unstable_cache(getCurveState, ["hood:curve-state"], cacheOpts);
