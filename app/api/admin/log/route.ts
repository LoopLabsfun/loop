import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder } from "@/lib/admin-guard";
import { getAdminSnapshot } from "@/lib/admin-data";

// Live admin log: the founder-gated snapshot the /admin console polls (~15s).
// Read-only. Founder identity comes from the session cookie (isFounder), re-bound
// to the live creator_wallet on every call.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("p") || "loop";
  const project = await getProject(key);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  if (!isFounder(req, project)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // getProject already overrides the stored snapshot with the live on-chain
  // treasury (withLiveBalances), so the snapshot's treasury figure is live.
  const snapshot = await getAdminSnapshot(project);
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
