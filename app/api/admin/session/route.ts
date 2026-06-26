import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { verifyAdminProof, type LaunchProof } from "@/lib/signature";
import { issueAdminToken, ADMIN_COOKIE } from "@/lib/admin-session";

// Open a founder admin session. The founder signs the canonical admin message
// with their wallet (lib/admin-message); we verify the ed25519 signature is
// genuine + recent AND that the signer IS the project's creator_wallet, then mint
// a short-lived httpOnly session cookie so the live log can poll without re-
// prompting the wallet. The signature is the only thing that proves founder
// identity here — there is no auth layer otherwise.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { key?: string; proof?: LaunchProof };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const key = body.key || "loop";
  const proof = body.proof;
  if (!proof?.pubkey || !proof.signature || !proof.message) {
    return NextResponse.json({ error: "missing proof" }, { status: 400 });
  }
  const project = await getProject(key);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  if (!project.creatorWallet) {
    return NextResponse.json(
      { error: "this project has no founder wallet on record — admin is unavailable" },
      { status: 403 }
    );
  }
  if (proof.pubkey !== project.creatorWallet || !verifyAdminProof(proof, key)) {
    return NextResponse.json({ error: "not the founder for this project" }, { status: 401 });
  }
  const token = issueAdminToken(proof.pubkey);
  if (!token) {
    return NextResponse.json(
      { error: "admin sessions not configured (set ADMIN_SESSION_SECRET or AGENT_TICK_SECRET)" },
      { status: 503 }
    );
  }
  const res = NextResponse.json({ ok: true, wallet: proof.pubkey, project: key });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 2 * 60 * 60,
  });
  return res;
}

// Sign out — clear the session cookie.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
