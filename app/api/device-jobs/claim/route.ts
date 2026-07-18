import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { authorizeCompute } from "@/lib/device-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Loop Compute pool scheduling: a device claims a backlog task before working
 * so the pool doesn't duplicate effort. Authorized by the shared ingest secret
 * OR a per-device token (x-device-token), which pins the claim to its own
 * deviceId. Atomic via the claim_device_task SQL function; degrades to
 * `granted: true` when the migration isn't applied yet (optimistic mode).
 */

export async function POST(req: Request) {
  const auth = authorizeCompute(req);
  if (!auth.ok) {
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
  const deviceId = auth.deviceId ?? (body.deviceId || "").trim().slice(0, 128);
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
    // PostgREST phrases it as "Could not find the function … in the schema
    // cache"; raw Postgres as "function … does not exist".
    if (/claim_device_task.*(does not exist|in the schema cache)/i.test(error.message)) {
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
