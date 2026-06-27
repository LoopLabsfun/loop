import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSolanaAddress } from "@/lib/api-guards";
import { verifyUserToken, USER_COOKIE } from "@/lib/user-session";
import { follow, unfollow, isFollowing } from "@/lib/social";
import { limited } from "@/lib/rate-limit";

// Follow / unfollow another wallet. The ACTOR is taken from the user session
// cookie (minted once at /api/session from a signed proof) — never from the
// request body — so a caller can only act as the wallet they proved they own.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Whether the signed-in wallet follows `?target=` — lets a follow control that
// renders without server-side state (e.g. the holder drawer) resolve itself.
export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("target");
  const actor = verifyUserToken(cookies().get(USER_COOKIE)?.value)?.wallet ?? null;
  if (!actor || !isSolanaAddress(target)) return NextResponse.json({ following: false });
  return NextResponse.json({ following: await isFollowing(actor, target) });
}

export async function POST(req: Request) {
  let body: { target?: string; action?: "follow" | "unfollow"; actor?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const actor = verifyUserToken(cookies().get(USER_COOKIE)?.value)?.wallet ?? null;
  if (!actor) {
    return NextResponse.json({ error: "no session — sign in first" }, { status: 401 });
  }
  // Stale-session guard: the client tells us which wallet it's connected as. If
  // the cookie was minted for a DIFFERENT wallet (e.g. a wallet switch in the
  // same browser), treat it as no-session so the client re-establishes one for
  // the wallet it's actually connected as — otherwise this follow would silently
  // act as (and write under) the previously-connected wallet.
  if (body.actor && isSolanaAddress(body.actor) && body.actor !== actor) {
    return NextResponse.json({ error: "stale session — re-sign", stale: true }, { status: 401 });
  }
  const rl = limited("follow", req, { wallet: actor, limit: 40, windowMs: 60_000 });
  if (rl) return rl;
  const target = body.target;
  if (!isSolanaAddress(target)) {
    return NextResponse.json({ error: "invalid target" }, { status: 400 });
  }
  const r = body.action === "unfollow" ? await unfollow(actor, target) : await follow(actor, target);
  if (!r.ok) return NextResponse.json({ error: r.error ?? "failed" }, { status: 400 });
  return NextResponse.json({ ok: true, following: body.action !== "unfollow" });
}
