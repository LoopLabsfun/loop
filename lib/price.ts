import "server-only";

import { SOL_USD } from "./format";

// Live SOL/USD spot price. Server-only so the upstream call never ships to the
// browser, and so the result can be threaded into Client Components as a prop
// (the same data-seam pattern as live treasury balances in solana.ts).
//
// Falls back to the static SOL_USD snapshot on any failure or non-OK response,
// so pages render correctly even when the price API is unreachable.

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

export async function getSolUsd(): Promise<number> {
  try {
    const res = await fetch(COINGECKO_URL, {
      // Cache for 60s across requests rather than hitting CoinGecko per render;
      // force-dynamic pages still pick up a fresh price within the window.
      next: { revalidate: 60 },
    });
    if (!res.ok) return SOL_USD;
    const json = (await res.json()) as { solana?: { usd?: number } };
    const price = json?.solana?.usd;
    return typeof price === "number" && price > 0 ? price : SOL_USD;
  } catch {
    return SOL_USD;
  }
}
