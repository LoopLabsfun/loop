import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder } from "@/lib/admin-guard";
import { getProvisioningChecklist } from "@/lib/provisioning-check";

// Founder-gated per-project provisioning checklist (read-only). Same auth shape
// as /api/admin/log. The retry actions live on /api/admin/control.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("p") || "loop";
  const project = await getProject(key);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  if (!isFounder(req, project)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const checklist = await getProvisioningChecklist(project);
  return NextResponse.json(checklist, { headers: { "Cache-Control": "no-store" } });
}
