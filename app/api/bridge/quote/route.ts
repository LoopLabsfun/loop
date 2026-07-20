import { NextResponse } from "next/server";
import { isSolanaAddress } from "@/lib/api-guards";
import {
  buildRelayQuoteRequest,
  normalizeRelayQuote,
  isBridgeChain,
  RELAY_QUOTE_URL,
  type BridgeChain,
  type RelayQuoteResponse,
} from "@/lib/bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Cross-chain bridge quote proxy (Solana <-> Hood) over Relay.
 *
 * Read-only, server-side: it validates the request (chains, address shapes,
 * amount) then forwards to Relay's public /quote/v2 and returns a normalised
 * quote. Proxying keeps the call same-origin (no CORS), lets us guard inputs
 * before hitting the upstream (DoS-amplification hygiene, like /api/swap), and
 * gives the UI one stable shape. No funds move here — this is a price preview;
 * the deposit tx is signed client-side by the user's own wallet.
 */

const EVM = /^0x[0-9a-fA-F]{40}$/;
const INT = /^[0-9]{1,32}$/;

function addressOk(chain: BridgeChain, addr: string): boolean {
  return chain === "hood" ? EVM.test(addr) : isSolanaAddress(addr);
}

export async function POST(req: Request) {
  let body: {
    fromChain?: unknown;
    toChain?: unknown;
    user?: unknown;
    recipient?: unknown;
    amount?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { fromChain, toChain } = body;
  if (!isBridgeChain(fromChain) || !isBridgeChain(toChain) || fromChain === toChain) {
    return NextResponse.json(
      { error: "fromChain and toChain must be distinct: 'solana' | 'hood'" },
      { status: 400 }
    );
  }

  const user = String(body.user ?? "").trim();
  const recipient = String(body.recipient ?? "").trim();
  const amount = String(body.amount ?? "").trim();

  if (!addressOk(fromChain, user)) {
    return NextResponse.json({ error: "invalid user address for fromChain" }, { status: 400 });
  }
  if (!addressOk(toChain, recipient)) {
    return NextResponse.json({ error: "invalid recipient address for toChain" }, { status: 400 });
  }
  if (!INT.test(amount) || /^0+$/.test(amount)) {
    return NextResponse.json(
      { error: "amount must be a positive integer in smallest units (lamports / wei)" },
      { status: 400 }
    );
  }

  const relayReq = buildRelayQuoteRequest({ fromChain, toChain, user, recipient, amount });

  let upstream: Response;
  try {
    upstream = await fetch(RELAY_QUOTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(relayReq),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "bridge upstream unreachable" }, { status: 502 });
  }

  const json = (await upstream.json().catch(() => null)) as
    | (RelayQuoteResponse & { message?: string; errorCode?: string })
    | null;
  if (!upstream.ok || !json || !json.details) {
    return NextResponse.json(
      { error: "no route for this pair/amount", detail: json?.message || json?.errorCode || upstream.status },
      { status: 502 }
    );
  }

  return NextResponse.json(
    { ok: true, fromChain, toChain, quote: normalizeRelayQuote(json) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
