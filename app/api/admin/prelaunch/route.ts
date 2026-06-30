import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder } from "@/lib/admin-guard";
import { isSolanaAddress } from "@/lib/api-guards";
import {
  resolveDraftLaunch,
  prelaunchPreflight,
  listPrelaunches,
  setPrelaunchStatus,
  approvePrelaunch,
  syncPrelaunchContributions,
  getPrelaunchFunding,
  refundPrelaunch,
  updatePrelaunchDraft,
  provisionDraftHome,
  type DraftFieldPatch,
} from "@/lib/prelaunch";

// Founder-only PRE-LAUNCH curation, all gated by the LOOP admin session
// (isFounder, same gate as /api/admin/control).
//   GET            → list every draft (the curation panel)
//   GET ?wallet=   → resolve one draft into a launch plan + READ-ONLY preflight
//                    (the dry-run; spends no SOL)
//   POST whitelist/reject → just flips status
//   POST approve   → LIVE MINT (spends SOL). Requires confirm:true. Idempotent.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

async function gate(req: Request) {
  const loop = await getProject("loop");
  if (!loop) return { error: NextResponse.json({ error: "loop project not found" }, { status: 404 }) };
  if (!(await isFounder(req, loop))) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  return { ok: true as const };
}

export async function GET(req: Request) {
  const g = await gate(req);
  if ("error" in g) return g.error;

  const wallet = new URL(req.url).searchParams.get("wallet");
  if (wallet) {
    if (!isSolanaAddress(wallet)) {
      return NextResponse.json({ error: "valid ?wallet= required" }, { status: 400 });
    }
    const plan = await resolveDraftLaunch(wallet);
    if (!plan) return NextResponse.json({ error: "no pre-launch draft for that wallet" }, { status: 404 });
    const { ready, checks } = await prelaunchPreflight(plan);
    const funding = await getPrelaunchFunding(wallet);
    return NextResponse.json({ ready, plan, checks, funding });
  }

  return NextResponse.json({ drafts: await listPrelaunches() });
}

export async function POST(req: Request) {
  const g = await gate(req);
  if ("error" in g) return g.error;

  let body: { wallet?: string; action?: string; confirm?: boolean; fields?: DraftFieldPatch };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { wallet, action } = body;
  if (!isSolanaAddress(wallet)) {
    return NextResponse.json({ error: "valid wallet required" }, { status: 400 });
  }

  try {
    if (action === "edit") {
      await updatePrelaunchDraft(wallet, body.fields ?? {});
      return NextResponse.json({ ok: true });
    }
    if (action === "whitelist") {
      await setPrelaunchStatus(wallet, "whitelisted"); // also provisions the repo + Vercel home
      return NextResponse.json({ ok: true, status: "whitelisted" });
    }
    if (action === "provision-home") {
      // Manual retry — whitelisting already attempts this; use this when GitHub/
      // Vercel weren't armed yet at whitelist time, or the first attempt failed.
      const home = await provisionDraftHome(wallet);
      return NextResponse.json({ ok: home.ok, home });
    }
    if (action === "reject") {
      await setPrelaunchStatus(wallet, "rejected");
      // Honor the "refundable until launch" promise — best-effort, disarmed by default.
      const refund = await refundPrelaunch(wallet);
      return NextResponse.json({ ok: true, status: "rejected", refund });
    }
    if (action === "refund") {
      const refund = await refundPrelaunch(wallet);
      return NextResponse.json({ ok: true, refund });
    }
    if (action === "sync") {
      const added = await syncPrelaunchContributions(wallet);
      const funding = await getPrelaunchFunding(wallet);
      return NextResponse.json({ ok: true, added, funding });
    }
    if (action === "approve") {
      if (body.confirm !== true) {
        return NextResponse.json({ error: "approve requires confirm:true (spends SOL)" }, { status: 400 });
      }
      const res = await approvePrelaunch(wallet);
      return NextResponse.json({ ok: true, ...res });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
