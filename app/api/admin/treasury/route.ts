import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder } from "@/lib/admin-guard";
import { getTreasuryDiag } from "@/lib/treasury-diag";

// Founder-gated TREASURY DIAGNOSTIC (read-only). Same auth shape as /api/admin/log:
// session cookie re-bound to the project's live creator_wallet. Reads the chain +
// fee_ledger + agent_actions — moves no funds.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("p") || "loop";
  const project = await getProject(key);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  if (!(await isFounder(req, project))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const diag = await getTreasuryDiag(project);
  return NextResponse.json(diag, { headers: { "Cache-Control": "no-store" } });
}
