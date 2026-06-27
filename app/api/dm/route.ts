import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSolanaAddress } from "@/lib/api-guards";
import { verifyUserToken, USER_COOKIE } from "@/lib/user-session";
import { sendDm, getConversations, getThread, markThreadRead, getUnreadDmCount } from "@/lib/dm";
import { limited } from "@/lib/rate-limit";

// Wallet-to-wallet DMs. The participant is always the session-cookie wallet
// (minted from a signed proof) — never the body — so a caller can only read their
// own conversations and only send as themselves.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function me(): string | null {
  return verifyUserToken(cookies().get(USER_COOKIE)?.value)?.wallet ?? null;
}

// ?with=<wallet> → the thread with that peer (and mark it read). No param → the
// conversation list + total unread.
export async function GET(req: Request) {
  const w = me();
  if (!w) return NextResponse.json({ error: "no session" }, { status: 401 });
  const peer = new URL(req.url).searchParams.get("with");
  if (peer) {
    if (!isSolanaAddress(peer)) return NextResponse.json({ error: "invalid peer" }, { status: 400 });
    const [messages] = await Promise.all([getThread(w, peer), markThreadRead(w, peer)]);
    return NextResponse.json({ messages });
  }
  const [conversations, unread] = await Promise.all([getConversations(w), getUnreadDmCount(w)]);
  return NextResponse.json({ conversations, unread });
}

export async function POST(req: Request) {
  const w = me();
  if (!w) return NextResponse.json({ error: "no session" }, { status: 401 });
  const rl = limited("dm", req, { wallet: w, limit: 20, windowMs: 60_000 });
  if (rl) return rl;
  let body: { to?: string; body?: string; actor?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  // Stale-session guard (see /api/follow): if the cookie was minted for a
  // different wallet than the one the client is connected as, treat it as
  // no-session so the client re-signs — never send a DM as the wrong wallet.
  if (body.actor && isSolanaAddress(body.actor) && body.actor !== w) {
    return NextResponse.json({ error: "stale session — re-sign", stale: true }, { status: 401 });
  }
  if (!isSolanaAddress(body.to)) return NextResponse.json({ error: "invalid recipient" }, { status: 400 });
  if (typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "empty message" }, { status: 400 });
  }
  const r = await sendDm(w, body.to, body.body);
  if (!r.ok) return NextResponse.json({ error: r.error ?? "failed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
