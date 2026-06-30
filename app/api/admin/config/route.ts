import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder } from "@/lib/admin-guard";
import { getConfigView } from "@/lib/project-config";

// Founder-gated per-project operator config (Lot 5). Read-only here; writes go
// through /api/admin/control (config-set / config-clear). Same auth as the log.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("p") || "loop";
  const project = await getProject(key);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  if (!(await isFounder(req, project))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const knobs = await getConfigView(project.key);
  return NextResponse.json({ knobs }, { headers: { "Cache-Control": "no-store" } });
}
