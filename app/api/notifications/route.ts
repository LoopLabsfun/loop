import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyUserToken, isStaleSession, USER_COOKIE } from "@/lib/user-session";
import { getNotifications, getUnreadCount, markAllRead, syncEscalationNotifications } from "@/lib/social";
import { limited } from "@/lib/rate-limit";

// Read / clear the signed-in wallet's PRIVATE notification feed. The recipient is
// the user session cookie's wallet — notifications are never exposed to anyone
// else (the table is RLS-locked with no read policy; only this route, via the
// service role behind the session, can read them). No session ⇒ 401.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function wallet(): string | null {
  return verifyUserToken(cookies().get(USER_COOKIE)?.value)?.wallet ?? null;
}

export async function GET(req: Request) {
  const w = wallet();
  if (!w) return NextResponse.json({ error: "no session" }, { status: 401 });
  // The bell polls this every 60s per client; cap bursts (e.g. many tabs).
  const rl = limited("notifications", req, { wallet: w, limit: 60, windowMs: 60_000 });
  if (rl) return rl;
  // Stale cookie ⇒ don't leak the previous wallet's private feed. Treated as
  // no-session so the bell re-establishes for the connected wallet.
  if (isStaleSession(w, new URL(req.url).searchParams.get("actor"))) {
    return NextResponse.json({ error: "stale session", stale: true }, { status: 401 });
  }
  // Fold any open escalations into the feed first (founder-only, idempotent).
  await syncEscalationNotifications(w);
  const [items, unread] = await Promise.all([getNotifications(w), getUnreadCount(w)]);
  return NextResponse.json({ items, unread });
}

// Mark all read.
export async function POST() {
  const w = wallet();
  if (!w) return NextResponse.json({ error: "no session" }, { status: 401 });
  await markAllRead(w);
  return NextResponse.json({ ok: true });
}
