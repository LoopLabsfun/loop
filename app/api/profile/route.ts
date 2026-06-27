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

// A @username handle: lowercase a-z0-9_, 3-20. Returns the normalized handle, ""
// to clear it, or `false` when the input is present but invalid.
function normUsername(s: unknown): string | "" | false {
  if (s === undefined || s === null || s === "") return "";
  if (typeof s !== "string") return false;
  const t = s.trim().replace(/^@/, "").toLowerCase();
  if (t === "") return "";
  return /^[a-z0-9_]{3,20}$/.test(t) ? t : false;
}

export async function POST(req: Request) {
  let body: { wallet?: string; proof?: LaunchProof; username?: string; displayName?: string; bio?: string; avatarUrl?: string };
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

  const username = normUsername(body.username);
  if (username === false) {
    return NextResponse.json({ error: "username must be 3–20 chars: letters, numbers, or _" }, { status: 400 });
  }
  const row = {
    wallet,
    username: username === "" ? null : username,
    display_name: cap(body.displayName, 40),
    bio: cap(body.bio, 160),
    avatar_url: safeUrl(body.avatarUrl),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("profiles").upsert(row, { onConflict: "wallet" });
  if (error) {
    // 23505 = unique violation on the username index → friendly conflict message.
    const taken = error.code === "23505" || /duplicate|unique/i.test(error.message);
    return NextResponse.json(
      { error: taken ? "that username is already taken" : error.message },
      { status: taken ? 409 : 500 }
    );
  }
  return NextResponse.json({ ok: true, wallet });
}
