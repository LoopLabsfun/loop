import { NextResponse } from "next/server";
import { verifyProfileProof, type LaunchProof } from "@/lib/signature";
import { isSolanaAddress } from "@/lib/api-guards";
import { issueUserToken, USER_COOKIE } from "@/lib/user-session";
import { limited } from "@/lib/rate-limit";

// Open a USER session. The user signs the canonical `looplabs.fun profile`
// message once; we verify the ed25519 signature is genuine + recent AND that the
// signer IS the wallet, then mint a 7-day httpOnly session cookie so social
// actions (follow, notifications) don't re-prompt the wallet. Non-privileged:
// the cookie only ever authorizes actions on the signer's OWN wallet.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const rl = limited("session", req, { limit: 15, windowMs: 60_000 });
  if (rl) return rl;
  let body: { wallet?: string; proof?: LaunchProof };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const wallet = body.wallet;
  const proof = body.proof;
  if (!isSolanaAddress(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  if (!proof?.pubkey || !proof.signature || !proof.message) {
    return NextResponse.json({ error: "missing proof" }, { status: 400 });
  }
  if (proof.pubkey !== wallet || !verifyProfileProof(proof, wallet)) {
    return NextResponse.json({ error: "signature does not prove this wallet" }, { status: 401 });
  }
  const token = issueUserToken(wallet);
  if (!token) {
    return NextResponse.json({ error: "user sessions not configured" }, { status: 503 });
  }
  const res = NextResponse.json({ ok: true, wallet });
  res.cookies.set(USER_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}

// Sign out — clear the session cookie.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
