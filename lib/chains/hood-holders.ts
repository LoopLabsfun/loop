import "server-only";

import type { Holder } from "../types";
import { HOOD_EXPLORER } from "./registry";

// Top holders for a Hood (Robinhood Chain) token — the EVM counterpart of
// solana.ts's getTopHolders. There's no `getTokenLargestAccounts` on an EVM
// chain, so this reads Blockscout's token-holders index (the explorer already
// ranks holders by balance). Best-effort like the Solana path: [] on any
// failure, and the whole list stays unlabelled rather than being lost if the
// contract check fails.
//
// `is_contract` is the Hood equivalent of the Solana "pool" flag: a v3 pool,
// the locker, or any contract holding supply isn't a person, and counting it
// makes the token look artificially concentrated.

const API = `${HOOD_EXPLORER}/api/v2`;
const EVM = /^0x[0-9a-fA-F]{40}$/;

interface BlockscoutHolder {
  address?: { hash?: string; is_contract?: boolean };
  value?: string;
}

async function bsGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * The `n` largest holders of a Hood token, as shares of total supply. Marks
 * contract-owned balances (pools/locker/vaults) with `pool` so the UI can
 * exclude them from the concentration figure, mirroring the Solana reader.
 */
export async function getHoodHolders(token: string, n = 10): Promise<Holder[]> {
  if (!EVM.test(token)) return [];

  const [info, list] = await Promise.all([
    bsGet<{ total_supply?: string }>(`/tokens/${token}`),
    bsGet<{ items?: BlockscoutHolder[] }>(`/tokens/${token}/holders`),
  ]);

  return mapHolders(list?.items ?? [], info?.total_supply ?? "", n);
}

/**
 * Pure mapping from Blockscout holder rows + a total-supply string to the shared
 * Holder shape. Extracted so the share math (fixed-point to keep sub-1%
 * precision on a 1e27-supply token) is unit-testable without the network.
 */
export function mapHolders(items: BlockscoutHolder[], totalSupply: string, n: number): Holder[] {
  const total = safeBig(totalSupply);
  if (!total || total <= BigInt(0) || !items.length) return [];
  return items
    .slice(0, n)
    .map((h) => {
      const address = h.address?.hash ?? "";
      const value = safeBig(h.value ?? "0");
      if (!address || value === null || value <= BigInt(0)) return null;
      const share = Number((value * BigInt(1_000_000)) / total) / 1_000_000;
      const holder: Holder = { address, share };
      if (h.address?.is_contract) {
        holder.pool = true;
        holder.poolLabel = "pool / contract";
      }
      return holder;
    })
    .filter((h): h is Holder => h !== null && h.share > 0);
}

/** Parse a decimal string to bigint, or null when it isn't one. */
function safeBig(s: string): bigint | null {
  if (!/^\d+$/.test(s.trim())) return null;
  try {
    return BigInt(s.trim());
  } catch {
    return null;
  }
}
