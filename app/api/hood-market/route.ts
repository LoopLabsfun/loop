import { NextResponse } from "next/server";
import { getEthUsd } from "@/lib/price";
import { getHoodTokenMarket } from "@/lib/chains/hood-market";
import { getPonsHistory } from "@/lib/chains/pons-history";
import { isPonsLaunchpad } from "@/lib/chains/pons-market";
import { getProject } from "@/lib/queries";
import { isAddressForChain } from "@/lib/chains/registry";

export const dynamic = "force-dynamic";

// Live market refresh for a HOOD token — the EVM counterpart of /api/market.
// Candles + trades come from the Pons v3 pool's Swap logs (pons-history), stats
// from the pool/curve reader. The client passes the project slug so we read its
// launchpad from the DB rather than trusting a query param to decide the source.
// Best-effort: empty pieces on failure, same shape the Solana route returns.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mint = searchParams.get("mint");
  const slug = searchParams.get("p");
  const tf = searchParams.get("tf") ?? "1H";
  if (!mint || !isAddressForChain(mint, "hood") || !slug) {
    return NextResponse.json({ error: "mint and p required" }, { status: 400 });
  }

  // Resolve the project so its launchpad (Pons vs HoodLauncher) picks the reader;
  // fall back to the static registry like the rest of the seam.
  const project = await getProject(slug).catch(() => null);
  if (!project || project.chain !== "hood" || project.mint !== mint) {
    return NextResponse.json({ stats: null, candles: [], trades: [] });
  }

  const ethUsd = await getEthUsd();
  const [{ stats }, history] = await Promise.all([
    getHoodTokenMarket(project, ethUsd),
    isPonsLaunchpad(project.launchpad)
      ? getPonsHistory(mint, ethUsd, tf)
      : Promise.resolve({ candles: [], trades: [] }),
  ]);
  return NextResponse.json({ stats, candles: history.candles, trades: history.trades });
}
