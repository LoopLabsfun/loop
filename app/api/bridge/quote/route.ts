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
import { requestIdFromSteps, type RelayStep } from "@/lib/relay-execute";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Cross-chain swap/bridge quote proxy (Solana <-> Hood) over Relay.
 *
 * Read-only, server-side: validates the request (chains, address shapes,
 * currency shapes, amount), forwards to Relay's public /quote/v2, and returns
 * BOTH a normalised quote AND the raw executable `steps` + `requestId` so the
 * swap runs IN-APP (the client signs the deposit in the user's own wallet — no
 * external handoff). Proxying keeps it same-origin, guards inputs before the
 * upstream (DoS-amplification hygiene like /api/swap), and stabilises the shape.
 * No funds move here — the deposit tx is signed client-side, non-custodially.
 */

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
// A currency is a chain address OR a native placeholder (SOL 32-ones / ETH zero).
const CURRENCY = /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
const INT = /^[0-9]{1,32}$/;

function addressOk(chain: BridgeChain, addr: string): boolean {
  return chain === "hood" ? EVM_ADDR.test(addr) : isSolanaAddress(addr);
}

export async function POST(req: Request) {
  let body: {
    fromChain?: unknown;
    toChain?: unknown;
    user?: unknown;
    recipient?: unknown;
    amount?: unknown;
    fromCurrency?: unknown;
    toCurrency?: unknown;
    slippageBps?: unknown;
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
  const fromCurrency = body.fromCurrency ? String(body.fromCurrency).trim() : undefined;
  const toCurrency = body.toCurrency ? String(body.toCurrency).trim() : undefined;
  const slippageBps =
    typeof body.slippageBps === "number" && Number.isFinite(body.slippageBps)
      ? body.slippageBps
      : undefined;

  if (!addressOk(fromChain, user)) {
    return NextResponse.json({ error: "invalid user address for fromChain" }, { status: 400 });
  }
  if (!addressOk(toChain, recipient)) {
    return NextResponse.json({ error: "invalid recipient address for toChain" }, { status: 400 });
  }
  if (!INT.test(amount) || /^0+$/.test(amount)) {
    return NextResponse.json(
      { error: "amount must be a positive integer in smallest units" },
      { status: 400 }
    );
  }
  if ((fromCurrency && !CURRENCY.test(fromCurrency)) || (toCurrency && !CURRENCY.test(toCurrency))) {
    return NextResponse.json({ error: "invalid currency address" }, { status: 400 });
  }

  const relayReq = buildRelayQuoteRequest({
    fromChain,
    toChain,
    user,
    recipient,
    amount,
    fromCurrency,
    toCurrency,
    slippageBps,
  });

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
    | (RelayQuoteResponse & { steps?: RelayStep[]; message?: string; errorCode?: string })
    | null;
  if (!upstream.ok || !json || !json.details) {
    return NextResponse.json(
      { error: "no route for this pair/amount", detail: json?.message || json?.errorCode || upstream.status },
      { status: 502 }
    );
  }

  const steps = Array.isArray(json.steps) ? json.steps : [];
  return NextResponse.json(
    {
      ok: true,
      fromChain,
      toChain,
      quote: normalizeRelayQuote(json),
      steps,
      requestId: requestIdFromSteps(steps),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
