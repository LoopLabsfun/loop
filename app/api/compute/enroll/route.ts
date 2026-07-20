import { NextResponse } from "next/server";
import { verifyComputeEnrollProof, type LaunchProof } from "@/lib/signature";
import { issueDeviceToken } from "@/lib/device-auth";
import { computeDeviceId, computeDeviceName } from "@/lib/compute-message";
import { isSolanaAddress } from "@/lib/api-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public beta onboarding for the Loop Compute pool — self-service enrollment.
 *
 * A wallet signs the canonical compute-enroll message in the browser; a valid
 * proof mints a stateless device token (dt1.web-<wallet>.<hmac>) bound to that
 * wallet. No table, no session: the token IS the credential, the wallet IS the
 * payout identity. Rotating DEVICE_TOKEN_SECRET revokes the whole beta fleet.
 */
export async function POST(req: Request) {
  let body: { wallet?: string; proof?: LaunchProof };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const wallet = (body.wallet || "").trim();
  const proof = body.proof;
  if (!wallet || !isSolanaAddress(wallet) || !proof) {
    return NextResponse.json({ error: "wallet and proof required" }, { status: 400 });
  }
  // The signature must be genuine AND signed by the wallet it enrolls.
  if (proof.pubkey !== wallet || !verifyComputeEnrollProof(proof, wallet)) {
    return NextResponse.json({ error: "invalid proof" }, { status: 401 });
  }

  const deviceId = computeDeviceId(wallet);
  const token = issueDeviceToken(deviceId);
  if (!token) {
    return NextResponse.json({ error: "compute pool not configured" }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    token,
    deviceId,
    deviceName: computeDeviceName(wallet),
    payoutAddress: wallet,
  });
}
