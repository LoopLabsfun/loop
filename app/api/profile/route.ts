import { NextResponse } from "next/server";
import { verifyProfileProof, type LaunchProof } from "@/lib/signature";
import { isSolanaAddress } from "@/lib/api-guards";
import { supabaseAdmin } from "@/lib/supabase";

// Edit a user PROFILE. The owner signs the canonical `loop.fun profile` message
// with their wallet (lib/profile-message); we verify the ed25519 signature is
// genuine + recent AND that the signer IS the wallet being edited, then upsert via
// the service role (RLS has no anon write policy — same posture as launch). Twitter
// linking is NOT handled here; it's the Privy flow (Lot 2), kept verified-only.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const cap = (s: unknown, n: number): string | null => {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, n) : null;
};

// Only allow a plain http(s) image URL (no data: / javascript: / other schemes).
const safeUrl = (s: unknown): string | null => {
  const t = cap(s, 400);
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? t : null;
  } catch {
    return null;
  }
};

export async function POST(req: Request) {
  let body: { wallet?: string; proof?: LaunchProof; displayName?: string; bio?: string; avatarUrl?: string };
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
  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  const row = {
    wallet,
    display_name: cap(body.displayName, 40),
    bio: cap(body.bio, 160),
    avatar_url: safeUrl(body.avatarUrl),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("profiles").upsert(row, { onConflict: "wallet" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, wallet });
}
