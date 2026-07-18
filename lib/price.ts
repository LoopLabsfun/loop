import "server-only";

import { SOL_USD, ETH_USD } from "./format";

// Live SOL/USD spot price. Server-only so the upstream call never ships to the
// browser, and so the result can be threaded into Client Components as a prop
// (the same data-seam pattern as live treasury balances in solana.ts).
//
// Falls back to the static SOL_USD snapshot on any failure or non-OK response,
// so pages render correctly even when the price API is unreachable.

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum&vs_currencies=usd";

/** Live spot price for a CoinGecko id, falling back to `fallback` on any
 *  failure. One 60s-cached request covers both SOL and ETH. */
async function getUsd(id: "solana" | "ethereum", fallback: number): Promise<number> {
  try {
    const res = await fetch(COINGECKO_URL, {
      // Cache for 60s across requests rather than hitting CoinGecko per render;
      // force-dynamic pages still pick up a fresh price within the window.
      next: { revalidate: 60 },
    });
    if (!res.ok) return fallback;
    const json = (await res.json()) as Record<string, { usd?: number }>;
    const price = json?.[id]?.usd;
    return typeof price === "number" && price > 0 ? price : fallback;
  } catch {
    return fallback;
  }
}

export function getSolUsd(): Promise<number> {
  return getUsd("solana", SOL_USD);
}

/** Live ETH/USD spot — the native currency on Hood (Robinhood Chain). Same
 *  fallback + caching posture as getSolUsd. */
export function getEthUsd(): Promise<number> {
  return getUsd("ethereum", ETH_USD);
}
