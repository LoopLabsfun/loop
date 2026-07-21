import { NextResponse } from "next/server";
import { verifyDeviceToken } from "@/lib/device-auth";
import { buildClaimTx, confirmClaim, quoteClaim } from "@/lib/compute-claim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Claim-pull payout endpoints for the compute pool. The device token (minted
 * at enrollment, HMAC-bound to the wallet) is the credential; the destination
 * is always the ENROLLED payout address — never client-supplied. The user
 * signs the returned transaction as fee payer, paying their own network fee
 * and token-account rent; the treasury only co-signs the $LOOP transfer.
 * See lib/compute-claim.ts.
 *
 *   GET              → { claimableLoop, pendingLoop }
 *   POST {}          → build: { txBase64, claimLoop }
 *   POST {signature} → confirm: { claimedLoop }
 */
function deviceIdFrom(req: Request): string | null {
  return verifyDeviceToken(req.headers.get("x-device-token"));
}

export async function GET(req: Request) {
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return NextResponse.json({ error: "invalid device token" }, { status: 401 });
  const quote = await quoteClaim(deviceId);
  return NextResponse.json(quote, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const deviceId = deviceIdFrom(req);
  if (!deviceId) return NextResponse.json({ error: "invalid device token" }, { status: 401 });
  let body: { signature?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body → build
  }
  const signature = (body.signature || "").trim();
  if (signature) {
    const result = await confirmClaim(deviceId, signature);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }
  const built = await buildClaimTx(deviceId);
  return NextResponse.json(built, { status: built.ok ? 200 : 400 });
}
