import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { getSplBalance } from "@/lib/solana";
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
    tokenUi = await getSplBalance(
      project.treasuryWallet,
      project.mint,
      project.network
    );
  }
  const solUsd = await getSolUsd();
  const valueUsd =
    balanceSol * solUsd + (tokenUi ?? 0) * (project.price || 0);

  return NextResponse.json(
    {
      key: project.key,
      balanceSol,
      tokenUi,
      valueUsd,
      live: Boolean(project.treasuryLive),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
