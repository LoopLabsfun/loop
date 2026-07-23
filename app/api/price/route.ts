import { NextResponse } from "next/server";
import { getMarketStats } from "@/lib/market";
import { isSolanaAddress } from "@/lib/api-guards";

export const dynamic = "force-dynamic";

// The lightest possible live-price read for any mint: price + 24h change, no
// candles, no trades. The chart polls this every few seconds so its last candle
// tracks the market between the heavy /api/market refreshes. Upstream cost is
// flat — getMarketStats is memoized ~15s server-side, so a faster client poll
// costs nothing extra at DexScreener. Best-effort: nulls on any failure.
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint");
  if (!isSolanaAddress(mint)) {
    return NextResponse.json({ error: "mint required" }, { status: 400 });
  }
  const stats = await getMarketStats(mint).catch(() => null);
  return NextResponse.json(
    { priceUsd: stats?.priceUsd ?? null, change24h: stats?.priceChange24h ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
