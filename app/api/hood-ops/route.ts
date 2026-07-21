import { NextResponse } from "next/server";
import { runHoodSweep, runHoodBuyback, hoodOpsConfig } from "@/lib/chains/hood-ops";
import { secretsMatch } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Recurring Hood on-chain ops: fee sweep (withdrawFees) + LOOP buyback on the
 * curve. Hit by the same GitHub Actions cadence as the buybot (hood-buybot.yml).
 * DORMANT until the Hood envs are set, and a dry run until HOOD_OPS_ARMED=1 —
 * so it's safe to wire before the launcher even exists. See
 * lib/chains/hood-ops.ts for the gates.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim() || "";
  if (!secret) return false;
  return secretsMatch(req.headers.get("authorization"), `Bearer ${secret}`);
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cfg = hoodOpsConfig();
  const sweep = await runHoodSweep(cfg);
  const buyback = await runHoodBuyback(cfg);
  const ok = sweep.ok && buyback.ok;
  return NextResponse.json(
    { ok, armed: cfg.armed, sweep, buyback },
    { status: ok ? 200 : 500, headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
