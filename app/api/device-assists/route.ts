import { NextResponse } from "next/server";
import { publishDeviceAssist, getDeviceAssists } from "@/lib/device-assists";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Loop Compute ingest + public read of device assists.
 *
 * POST — authorized by COMPUTE_INGEST_SECRET or CRON_SECRET (Bearer or x-compute-secret).
 * GET  — public list for a project (?project=loop&limit=10).
 */

function authorized(req: Request): boolean {
  const secret =
    process.env.COMPUTE_INGEST_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  if (!secret) return false;
  const header =
    req.headers.get("x-compute-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  return header === secret;
}

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
  if (!authorized(req)) {
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

  const result = await publishDeviceAssist({
    projectKey,
    taskId,
    jobId,
    title,
    deviceId: (body.deviceId || "unknown").slice(0, 128),
    deviceName: body.deviceName?.slice(0, 128),
    complexity: body.complexity?.slice(0, 16),
    keywords: Array.isArray(body.keywords) ? body.keywords.map(String).slice(0, 20) : [],
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
