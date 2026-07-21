import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { getMarketStats } from "@/lib/market";

export const dynamic = "force-dynamic";

// Lightweight $LOOP ticker for the shared site header: the official mint (CA)
// plus live price / 24h change. One small payload polled ~60s client-side —
// deliberately NOT /api/market (which also fetches candles + trades). Best
// effort: nulls on any failure so the header degrades to just the pill.
export async function GET() {
  const p = await getProject("loop").catch(() => null);
  const mint = p?.mint ?? null;
  const stats = mint ? await getMarketStats(mint).catch(() => null) : null;
  return NextResponse.json(
    {
      mint,
      network: p?.network ?? "mainnet",
      priceUsd: stats?.priceUsd ?? null,
      change24h: stats?.priceChange24h ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
