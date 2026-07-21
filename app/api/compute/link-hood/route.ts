import { NextResponse } from "next/server";
import { verifyHoodLinkProof, type LaunchProof } from "@/lib/signature";
import { verifyEvmPersonalSign } from "@/lib/evm-signature";
import { issueDeviceTokenWithHood } from "@/lib/device-auth";
import { computeDeviceId, computeDeviceName } from "@/lib/compute-message";
import { isSolanaAddress } from "@/lib/api-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVM_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * Link a Hood (EVM) payout wallet to an already-enrolled Loop Compute device.
 * LOOP will soon have both a Solana AND a Hood treasury — a task funded by
 * one pays in that chain's native token, so a device needs both payout
 * destinations on file. Requires BOTH wallets to sign the exact same
 * canonical message (buildHoodLinkMessage): the Solana wallet with an
 * ed25519 proof (verifyHoodLinkProof, same shape as every other signed
 * action here), the Hood wallet with an EIP-191 personal_sign
 * (verifyEvmPersonalSign) — a mutual proof neither wallet can produce alone,
 * so a device can't link a payout address it doesn't control. On success,
 * reissues the device's token as v2 (dt2), now carrying the linked address.
 */
export async function POST(req: Request) {
  let body: { wallet?: string; proof?: LaunchProof; hoodAddress?: string; hoodSignature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const wallet = (body.wallet || "").trim();
  const proof = body.proof;
  const hoodAddress = (body.hoodAddress || "").trim();
  const hoodSignature = (body.hoodSignature || "").trim();

  if (!wallet || !isSolanaAddress(wallet) || !proof) {
    return NextResponse.json({ error: "wallet and proof required" }, { status: 400 });
  }
  if (!hoodAddress || !EVM_ADDR_RE.test(hoodAddress) || !hoodSignature) {
    return NextResponse.json({ error: "hoodAddress and hoodSignature required" }, { status: 400 });
  }

  // The Solana half: same posture as /api/compute/enroll — the proof must be
  // genuine AND signed by the wallet it claims.
  if (proof.pubkey !== wallet || !verifyHoodLinkProof(proof, wallet, hoodAddress)) {
    return NextResponse.json({ error: "invalid solana proof" }, { status: 401 });
  }
  // The Hood half: the EVM wallet must have signed the SAME message text the
  // Solana proof carries — that's what binds the two into one mutual proof.
  if (!verifyEvmPersonalSign(proof.message, hoodSignature, hoodAddress)) {
    return NextResponse.json({ error: "invalid hood signature" }, { status: 401 });
  }

  const deviceId = computeDeviceId(wallet);
  const token = issueDeviceTokenWithHood(deviceId, hoodAddress);
  if (!token) {
    return NextResponse.json({ error: "compute pool not configured" }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    token,
    deviceId,
    deviceName: computeDeviceName(wallet),
    payoutAddress: wallet,
    payoutAddressHood: hoodAddress.toLowerCase(),
  });
}
