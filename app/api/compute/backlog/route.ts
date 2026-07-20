import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Work feed for browser nodes: the open (todo) backlog of a project plus which
 * task ids already have a device assist — same data the native nodes assemble
 * from Supabase directly, served same-origin so the browser client needs no
 * keys and no CORS. Read-only, public (the backlog already is), no secrets.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const project = (searchParams.get("project") || "loop").slice(0, 64);
  const limit = Math.min(Number(searchParams.get("limit") || 20), 50);

  if (!supabase) {
    return NextResponse.json({ project, tasks: [], preppedTaskIds: [] });
  }

  const [tasksRes, assistsRes] = await Promise.all([
    supabase
      .from("agent_tasks")
      .select("id, project_key, title, detail, status, priority, category")
      .eq("project_key", project)
      .eq("status", "todo")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(limit),
    supabase
      .from("device_assists")
      .select("task_id")
      .eq("project_key", project)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const tasks = (tasksRes.data ?? []).map((t) => ({
    id: Number(t.id),
    projectKey: String(t.project_key),
    title: String(t.title ?? ""),
    detail: String(t.detail ?? ""),
    status: String(t.status ?? "todo"),
    priority: Number(t.priority ?? 0),
    category: String(t.category ?? "feature"),
  }));
  const preppedTaskIds = Array.from(
    new Set(
      ((assistsRes.data ?? []) as { task_id: number | null }[])
        .map((r) => Number(r.task_id))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  );

  return NextResponse.json(
    { project, tasks, preppedTaskIds },
    { headers: { "Cache-Control": "no-store" } }
  );
}
