import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Loop Compute pool scheduling: a device claims a backlog task before working
 * so the pool doesn't duplicate effort. Authorized like the assist ingest
 * (COMPUTE_INGEST_SECRET or CRON_SECRET). Atomic via the claim_device_task
 * SQL function; degrades to `granted: true` when the migration isn't applied
 * yet (optimistic mode — the node's already-prepped check still dedupes).
 */

function authorized(req: Request): boolean {
  const secret =
    process.env.COMPUTE_INGEST_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
  if (!secret) return false;
  const header =
    req.headers.get("x-compute-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  return header === secret;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "no service role" }, { status: 503 });
  }
  let body: { projectKey?: string; taskId?: number; deviceId?: string; deviceName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const projectKey = (body.projectKey || "").trim().slice(0, 64);
  const taskId = Number(body.taskId);
  const deviceId = (body.deviceId || "").trim().slice(0, 128);
  if (!projectKey || !deviceId || !Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "projectKey, taskId, deviceId required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("claim_device_task", {
    p_project: projectKey,
    p_task: taskId,
    p_device: deviceId,
    p_device_name: body.deviceName?.slice(0, 128) ?? null,
  });

  if (error) {
    // Migration not applied yet → optimistic mode, everyone is granted.
    if (/function .*claim_device_task.* does not exist/i.test(error.message)) {
      return NextResponse.json({ granted: true, mode: "optimistic" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    granted: Boolean(row?.granted),
    mode: "claims",
    holder: row?.holder_device ?? null,
    expiresAt: row?.holder_expires ?? null,
  });
}
