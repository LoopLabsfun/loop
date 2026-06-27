import { NextResponse } from "next/server";
import { joinWaitlist } from "@/lib/waitlist";
import { limited } from "@/lib/rate-limit";

// Join the launch waitlist. Public + unauthenticated (anyone interested can sign
// up), so it's rate-limited and the body is validated server-side. Service-role
// write happens in lib/waitlist; the list is never publicly readable.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const rl = limited("waitlist", req, { limit: 8, windowMs: 60_000 });
  if (rl) return rl;
  let body: { wallet?: string; email?: string; xHandle?: string; idea?: string; referrer?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const r = await joinWaitlist(body);
  if (!r.ok) return NextResponse.json({ error: r.error ?? "failed" }, { status: 400 });
  return NextResponse.json({ ok: true, already: Boolean(r.already), messaged: Boolean(r.messaged) });
}
