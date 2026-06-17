import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Build a pump.fun swap transaction via PumpPortal's "trade-local" endpoint and
// return it (base64) for the user's wallet to sign + send client-side. Proxied
// server-side to avoid browser CORS; no keys involved — the user signs the tx,
// so funds only move with their approval. PumpPortal returns the raw serialized
// (unsigned) VersionedTransaction bytes.
const PUMPPORTAL = "https://pumpportal.fun/api/trade-local";

interface SwapBody {
  publicKey?: string;
  action?: "buy" | "sell";
  mint?: string;
  amount?: number | string;
  denominatedInSol?: boolean;
  slippage?: number;
}

export async function POST(req: Request) {
  let body: SwapBody;
  try {
    body = (await req.json()) as SwapBody;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { publicKey, action, mint, amount } = body;
  if (!publicKey || !mint || (action !== "buy" && action !== "sell") || !amount) {
    return NextResponse.json({ error: "missing swap params" }, { status: 400 });
  }

  try {
    const res = await fetch(PUMPPORTAL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        publicKey,
        action,
        mint,
        amount,
        denominatedInSol: body.denominatedInSol ? "true" : "false",
        slippage: body.slippage ?? 10,
        priorityFee: 0.00005,
        pool: "auto",
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `swap build failed (${res.status})`, detail: detail.slice(0, 300) },
        { status: 502 }
      );
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: "empty swap transaction" }, { status: 502 });
    }
    const tx = Buffer.from(buf).toString("base64");
    return NextResponse.json({ tx });
  } catch {
    return NextResponse.json({ error: "swap upstream error" }, { status: 502 });
  }
}
