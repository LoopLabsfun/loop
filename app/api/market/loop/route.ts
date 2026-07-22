import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { getMarketStats } from "@/lib/market";
import { deploymentOn } from "@/lib/chains/deployments";

export const dynamic = "force-dynamic";

// Lightweight $LOOP ticker for the shared site header: the official mint (CA)
// plus live price / 24h change. One small payload polled ~60s client-side —
// deliberately NOT /api/market (which also fetches candles + trades). Best
// effort: nulls on any failure so the header degrades to just the pill.
//
// `mints` carries the CA on EVERY chain $LOOP is deployed on, so the header's
// chain switch shows the right contract from the DB instead of a build-time
// env var (one project, N chains — lib/chains/deployments.ts).
export async function GET() {
  const p = await getProject("loop").catch(() => null);
  const mint = p?.mint ?? null;
  const stats = mint ? await getMarketStats(mint).catch(() => null) : null;
  return NextResponse.json(
    {
      mint,
      mints: {
        solana: p ? deploymentOn(p, "solana")?.mint ?? null : null,
        hood: p ? deploymentOn(p, "hood")?.mint ?? null : null,
      },
      network: p?.network ?? "mainnet",
      priceUsd: stats?.priceUsd ?? null,
      change24h: stats?.priceChange24h ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
