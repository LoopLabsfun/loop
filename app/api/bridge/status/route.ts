import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Poll a Relay intent's fill status (same-origin proxy — avoids CORS and keeps
// the poll server-side). The client hits this after signing the deposit, until
// status is "success" or "failure". requestId is the 0x… id from the quote.
const REQ_ID = /^0x[0-9a-fA-F]{1,80}$/;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requestId = (searchParams.get("requestId") || "").trim();
  if (!REQ_ID.test(requestId)) {
    return NextResponse.json({ error: "invalid requestId" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.relay.link/intents/status/v3?requestId=${encodeURIComponent(requestId)}`,
      { cache: "no-store" }
    );
  } catch {
    return NextResponse.json({ error: "status upstream unreachable" }, { status: 502 });
  }
  const json = (await upstream.json().catch(() => null)) as
    | { status?: string; details?: unknown; txHashes?: unknown }
    | null;
  if (!upstream.ok || !json) {
    return NextResponse.json({ error: "status unavailable" }, { status: 502 });
  }
  return NextResponse.json(
    { status: json.status ?? "unknown", txHashes: json.txHashes ?? null },
    { headers: { "Cache-Control": "no-store" } }
  );
}
