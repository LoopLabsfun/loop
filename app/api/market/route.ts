import { NextResponse } from "next/server";
import { getMarketStats, getCandles, getRecentTrades } from "@/lib/market";

export const dynamic = "force-dynamic";

// Live market refresh for the token page: candles for the requested timeframe,
// recent trades, and current stats for a mint. Used client-side on timeframe
// change and for periodic polling. Best-effort — empty pieces on failure.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mint = searchParams.get("mint");
  const tf = searchParams.get("tf") ?? "1D";
  if (!mint) {
    return NextResponse.json({ error: "mint required" }, { status: 400 });
  }

  const stats = await getMarketStats(mint);
  if (!stats) {
    return NextResponse.json({ stats: null, candles: [], trades: [] });
  }
  const [candles, trades] = await Promise.all([
    getCandles(stats.pairAddress, tf),
    getRecentTrades(stats.pairAddress),
  ]);
  return NextResponse.json({ stats, candles, trades });
}
