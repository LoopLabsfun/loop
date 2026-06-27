import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder } from "@/lib/admin-guard";
import { isSolanaAddress } from "@/lib/api-guards";
import { resolveDraftLaunch, prelaunchPreflight } from "@/lib/prelaunch";

// Founder-only PRE-LAUNCH preflight (read-only · spends no SOL). Given a draft's
// wallet, it resolves the exact launch plan and reports readiness — the dry-run
// that proves a launch is configured right (dev-buy funded, vanity available,
// custody set, mainnet) BEFORE the live mint. Gated by the LOOP admin session
// (same founder gate as /api/admin/control). The live mint is a separate route.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const loop = await getProject("loop");
  if (!loop) return NextResponse.json({ error: "loop project not found" }, { status: 404 });
  if (!isFounder(req, loop)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!isSolanaAddress(wallet)) {
    return NextResponse.json({ error: "valid ?wallet= required" }, { status: 400 });
  }
  const plan = await resolveDraftLaunch(wallet);
  if (!plan) return NextResponse.json({ error: "no pre-launch draft for that wallet" }, { status: 404 });

  const { ready, checks } = await prelaunchPreflight(plan);
  return NextResponse.json({ ready, plan, checks });
}
