import { NextResponse } from "next/server";
import { runConsensus } from "@/lib/compute-consensus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scheduled anti-cheat: recompute k-redundancy consensus over device_assists,
 * persist per-device trust, and flag dissenting briefs. Authorized by the same
 * secret as the agent cron (CRON_SECRET / COMPUTE_INGEST_SECRET), so a Vercel
 * cron or the founder's tick can drive it.
 */
function authorized(req: Request): boolean {
  const secret =
    process.env.CRON_SECRET?.trim() || process.env.COMPUTE_INGEST_SECRET?.trim() || "";
  if (!secret) return false;
  const header =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.headers.get("x-compute-secret") ||
    "";
  return header === secret;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runConsensus();
  const status = result.ok ? 200 : 500;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
}

// GET so a Vercel cron (which issues GET) can trigger it; POST for manual runs.
export const GET = handle;
export const POST = handle;
