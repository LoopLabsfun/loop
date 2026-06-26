import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { verifyProfileProof, type LaunchProof } from "@/lib/signature";
import { isSolanaAddress } from "@/lib/api-guards";
import { supabaseAdmin } from "@/lib/supabase";

// Link a VERIFIED Twitter/X handle to a profile (Lot 2). Two independent proofs are
// required so the handle can't be spoofed onto someone else's wallet:
//   1. wallet ownership — a signed `looplabs.fun profile` proof (pubkey === wallet);
//   2. Twitter ownership — a Privy access token (JWT) we verify server-side via
//      Privy's JWKS, then read the verified linked account from Privy's REST API
//      (Basic auth with the app secret, same as the agent-wallet custody calls).
// Only when BOTH check out do we store twitter_handle + twitter_verified = true.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIVY_BASE = "https://api.privy.io/v1";

interface PrivyLinkedAccount {
  type: string;
  username?: string | null;
  subject?: string | null;
}

// Cache the remote JWKS across requests (keyed by app id).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksAppId: string | null = null;
function getJwks(appId: string) {
  if (!jwks || jwksAppId !== appId) {
    jwks = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`));
    jwksAppId = appId;
  }
  return jwks;
}

export async function POST(req: Request) {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json({ error: "Twitter linking not configured (PRIVY_APP_ID/SECRET)" }, { status: 503 });
  }

  let body: { wallet?: string; proof?: LaunchProof; accessToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { wallet, proof, accessToken } = body;
  if (!isSolanaAddress(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  if (!proof?.pubkey || !proof.signature || !proof.message) {
    return NextResponse.json({ error: "missing proof" }, { status: 400 });
  }
  if (proof.pubkey !== wallet || !verifyProfileProof(proof, wallet)) {
    return NextResponse.json({ error: "signature does not prove this wallet" }, { status: 401 });
  }
  if (!accessToken) {
    return NextResponse.json({ error: "missing Privy access token" }, { status: 400 });
  }

  // 2. Verify the Privy access token (JWT) and pull its subject (the Privy DID).
  let did: string;
  try {
    const { payload } = await jwtVerify(accessToken, getJwks(appId), {
      issuer: "privy.io",
      audience: appId,
    });
    if (!payload.sub) throw new Error("no subject");
    did = payload.sub;
  } catch {
    return NextResponse.json({ error: "invalid Privy session" }, { status: 401 });
  }

  // Fetch the verified user from Privy and read their linked Twitter handle.
  let handle: string | null = null;
  try {
    const res = await fetch(`${PRIVY_BASE}/users/${encodeURIComponent(did)}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
        "privy-app-id": appId,
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`privy ${res.status}`);
    const user = (await res.json()) as { linked_accounts?: PrivyLinkedAccount[] };
    const tw = (user.linked_accounts ?? []).find((a) => a.type === "twitter_oauth");
    handle = tw?.username?.replace(/^@/, "") ?? null;
  } catch {
    return NextResponse.json({ error: "could not read Privy account" }, { status: 502 });
  }
  if (!handle) {
    return NextResponse.json({ error: "no Twitter linked to this Privy account" }, { status: 400 });
  }

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  const { error } = await sb
    .from("profiles")
    .upsert(
      { wallet, twitter_handle: handle, twitter_verified: true, updated_at: new Date().toISOString() },
      { onConflict: "wallet" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, wallet, twitterHandle: handle });
}
