import { NextResponse } from "next/server";
import { publishDeviceAssist, getDeviceAssists } from "@/lib/device-assists";
import { authorizeCompute } from "@/lib/device-auth";
import { runAssist } from "@/lib/compute-work";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Loop Compute ingest + public read of device assists.
 *
 * POST — authorized by the shared ingest secret (founder devices / cron) OR a
 *        per-device token in x-device-token. Token auth pins the write to its
 *        own deviceId so a public device can't spoof another's identity.
 * GET  — public list for a project (?project=loop&limit=10).
 */

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const project = (searchParams.get("project") || "loop").slice(0, 64);
  const limit = Math.min(Number(searchParams.get("limit") || 10), 30);
  const assists = await getDeviceAssists(project, limit);
  return NextResponse.json(
    { project, count: assists.length, assists },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const auth = authorizeCompute(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: {
    projectKey?: string;
    taskId?: number;
    jobId?: string;
    title?: string;
    deviceId?: string;
    deviceName?: string;
    complexity?: string;
    keywords?: string[];
    prepBrief?: string;
    resultHash?: string;
    payoutAddress?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const projectKey = (body.projectKey || "").trim().slice(0, 64);
  const jobId = (body.jobId || "").trim().slice(0, 64);
  const title = (body.title || "").trim().slice(0, 500);
  const prepBrief = (body.prepBrief || "").trim();
  const taskId = Number(body.taskId);

  if (!projectKey || !jobId || !title || !prepBrief || !Number.isFinite(taskId)) {
    return NextResponse.json(
      { error: "projectKey, taskId, jobId, title, prepBrief required" },
      { status: 400 }
    );
  }

  // A device token binds the write to its own id; the shared secret trusts the
  // body. Prevents a public device from publishing under another's identity.
  const deviceId = auth.deviceId ?? (body.deviceId || "unknown").slice(0, 128);

  // Public (token-auth) submissions are VERIFIED, not trusted: the work unit is
  // deterministic, so the server recomputes it from the task row and rejects
  // anything that doesn't hash-match — a spoofed brief can't enter the pool.
  // Secret-auth callers (founder devices, cron) keep the trusted path, which
  // also carries native-node briefs with on-device-LLM enrichment appended.
  let canonical: Awaited<ReturnType<typeof verifyAgainstTask>> | null = null;
  if (auth.kind === "device-token") {
    canonical = await verifyAgainstTask(projectKey, taskId, prepBrief, body.resultHash);
    if (!canonical.ok) {
      return NextResponse.json({ error: canonical.reason }, { status: 422 });
    }
  }

  // On the verified path, display fields come from the recomputation — the
  // client's keywords/complexity/title are ignored, so they can't be spoofed
  // either. The trusted path keeps the body as-is.
  const verified = canonical && canonical.ok ? canonical.result : null;
  const result = await publishDeviceAssist({
    projectKey,
    taskId,
    jobId,
    title: verified?.title ?? title,
    deviceId,
    deviceName: body.deviceName?.slice(0, 128),
    complexity: verified?.complexity ?? body.complexity?.slice(0, 16),
    payoutAddress: body.payoutAddress?.trim().slice(0, 64) || undefined,
    keywords: verified?.keywords ?? (Array.isArray(body.keywords) ? body.keywords.map(String).slice(0, 20) : []),
    prepBrief: prepBrief.slice(0, 12000),
    resultHash: body.resultHash?.slice(0, 128),
  });

  if (!result.table && !result.action) {
    return NextResponse.json(
      { error: result.error || "persist failed", result },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, result });
}

/**
 * Recompute the deterministic assist for (project, task) and compare with what
 * the device submitted. Fails closed on a missing/closed task, open on a DB
 * outage only when we can't read at all (the claim route already gated access).
 */
async function verifyAgainstTask(
  projectKey: string,
  taskId: number,
  prepBrief: string,
  resultHash: string | undefined
): Promise<
  | { ok: true; result: import("@/lib/compute-work").AgentAssistResult | null }
  | { ok: false; reason: string }
> {
  if (!resultHash) return { ok: false, reason: "resultHash required for device submissions" };
  if (!supabase) return { ok: true, result: null }; // can't verify without a backend — dev only
  const { data, error } = await supabase
    .from("agent_tasks")
    .select("id, project_key, title, detail, status, priority, category")
    .eq("id", taskId)
    .eq("project_key", projectKey)
    .maybeSingle();
  if (error) return { ok: false, reason: "task lookup failed" };
  if (!data) return { ok: false, reason: "unknown task" };
  if (data.status !== "todo") return { ok: false, reason: "task is not open" };
  const { result, resultHash: expected } = await runAssist({
    kind: "agent_assist",
    projectKey,
    taskId,
    title: String(data.title ?? ""),
    detail: String(data.detail ?? ""),
    status: String(data.status ?? "todo"),
    priority: Number(data.priority ?? 0),
    category: String(data.category ?? "feature"),
    repo: null,
  });
  if (expected !== resultHash) return { ok: false, reason: "resultHash mismatch" };
  if (prepBrief !== result.prepBrief) return { ok: false, reason: "brief mismatch" };
  return { ok: true, result };
}
