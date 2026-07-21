import { NextResponse } from "next/server";
import { authorizeCompute } from "@/lib/device-auth";
import { submitTreasuryCheck } from "@/lib/treasury-checks";
import { getProjects } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Loop Compute's first non-LLM job: redundant treasury-balance verification.
 * See lib/treasury-checks.ts for the full design + its honesty caveat (v1
 * devices read via this app's own /api/rpc proxy — genuine oracle-grade
 * decentralization needs independent RPC endpoints, a later step).
 *
 * GET  — what's checkable right now: official, Solana-chain, live (has a
 *        treasury_wallet) projects, for the client to loop over.
 * POST — a device's independent balance read for one project. Authorized the
 *        same way as every other compute endpoint (shared secret or a
 *        per-device token); payout addresses are bound to the AUTHENTICATED
 *        identity (device-auth.ts), never the client body.
 */

export async function GET() {
  const projects = await getProjects();
  const checkable = projects
    .filter((p) => p.official && (p.chain ?? "solana") === "solana" && p.treasuryWallet)
    .map((p) => ({ projectKey: p.key, wallet: p.treasuryWallet as string }));
  return NextResponse.json({ projects: checkable }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const auth = authorizeCompute(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { projectKey?: string; wallet?: string; lamports?: number; deviceId?: string; deviceName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const projectKey = (body.projectKey || "").trim().slice(0, 64);
  const wallet = (body.wallet || "").trim();
  const lamports = Number(body.lamports);
  if (!projectKey || !wallet || !Number.isFinite(lamports) || lamports < 0) {
    return NextResponse.json({ error: "projectKey, wallet, lamports required" }, { status: 400 });
  }

  const deviceId = auth.deviceId ?? (body.deviceId || "unknown").slice(0, 128);
  // Same binding posture as /api/device-assists: for token-auth submissions,
  // payout addresses come from the verified identity, never the body.
  const payoutAddress =
    auth.kind === "device-token" ? deviceId.match(/^web-(.+)$/)?.[1] : undefined;
  const payoutAddressHood = auth.kind === "device-token" ? auth.hoodAddress ?? undefined : undefined;

  const result = await submitTreasuryCheck({
    projectKey,
    wallet,
    lamports,
    deviceId,
    deviceName: body.deviceName?.slice(0, 128),
    payoutAddress,
    payoutAddressHood,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "persist failed" }, { status: 500 });
  }
  return NextResponse.json(result);
}
