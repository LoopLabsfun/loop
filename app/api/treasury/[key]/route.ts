import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { getSplBalanceCached, getRecentTreasuryInflows } from "@/lib/solana";
import { getSolUsd } from "@/lib/price";

// Live treasury balance for a project. When the project has a treasury_wallet,
// getProject() resolves the real on-chain balance via Helius (server-side, key
// never exposed). Otherwise it returns the stored snapshot with live=false.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { key: string } }
) {
  const project = await getProject(params.key);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // The treasury also HOLDS the project's own token — for LOOP that's tens of
  // millions of tokens, which dwarfs the small SOL balance. Surface the full $
  // value (SOL + token holdings) so the treasury doesn't read as "tiny".
  const balanceSol = project.treasurySol;
  let tokenUi: number | null = null;
  if (project.treasuryWallet && project.mint) {
    tokenUi = await getSplBalanceCached(
      project.treasuryWallet,
      project.mint,
      project.network
    );
  }
  // getProject now applies withLiveMarket, so project.price is the LIVE market
  // price (not the stale 0 snapshot) — the treasury's tens of millions of tokens
  // are valued correctly instead of counting as $0.
  const solUsd = await getSolUsd();
  const valueUsd = balanceSol * solUsd + (tokenUi ?? 0) * (project.price || 0);

  // Real recent SOL inflows to the treasury wallet (pump.fun creator-fee claims,
  // trade-fee routes, donations) — the "Recent Claims" the founder was missing.
  // Best-effort: null/[] keeps the UI honest when unconfigured.
  const claims = project.treasuryWallet
    ? (await getRecentTreasuryInflows(project.treasuryWallet, project.network, 6)) ?? []
    : [];

  return NextResponse.json(
    {
      key: project.key,
      balanceSol,
      tokenUi,
      tokenPriceUsd: project.price || 0,
      valueUsd,
      claims,
      live: Boolean(project.treasuryLive),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
