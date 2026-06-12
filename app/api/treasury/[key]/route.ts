import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";

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
  return NextResponse.json(
    {
      key: project.key,
      balanceSol: project.treasurySol,
      live: Boolean(project.treasuryLive),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
