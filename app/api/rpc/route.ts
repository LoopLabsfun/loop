import { NextResponse } from "next/server";
import { heliusRpcUrl } from "@/lib/solana";

export const dynamic = "force-dynamic";

// Browser-safe Solana JSON-RPC proxy → Helius (server-only key).
//
// Why: the wallet adapter's Connection falls back to the public
// `api.mainnet-beta.solana.com` RPC, which 403s browser-origin requests. That
// broke EVERY signed transaction (buy/sell swaps + the $LOOP payments for ask /
// directive / proposal): `getLatestBlockhash` and `simulateTransaction` returned
// "403 Access forbidden", so a tx could never be built or sent. Routing the
// adapter's Connection at this same-origin proxy makes blockhash / simulate /
// send / confirm all go through Helius — reliably, and without exposing the key.
//
// Hardening: the upstream URL is FIXED (Helius), so there's no SSRF. To bound
// credit abuse of this unauthenticated proxy, only a fixed allowlist of the
// JSON-RPC methods the app actually needs is forwarded — anything else is
// rejected before a single outbound request (same posture as /api/market,
// /api/swap, /api/wallet-balance).

// Methods the wallet flows need: build/sign/simulate/send a tx and confirm it,
// plus the account/balance reads the adapter makes. Deliberately excludes heavy
// or scrape-friendly methods (e.g. getProgramAccounts) and any write beyond
// sendTransaction.
const ALLOWED = new Set<string>([
  "getLatestBlockhash",
  "getRecentBlockhash",
  "isBlockhashValid",
  "getFeeForMessage",
  "sendTransaction",
  "simulateTransaction",
  "getSignatureStatuses",
  "getSignatureStatus",
  "getTransaction",
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getMinimumBalanceForRentExemption",
  "getBlockHeight",
  "getSlot",
  "getEpochInfo",
  "getVersion",
  "getHealth",
  "getGenesisHash",
]);

type RpcCall = { method?: unknown };

function methodsAllowed(payload: unknown): boolean {
  // web3.js sends either a single JSON-RPC object or a batch array.
  const calls: RpcCall[] = Array.isArray(payload) ? payload : [payload as RpcCall];
  if (calls.length === 0 || calls.length > 50) return false;
  return calls.every(
    (c) => c && typeof c.method === "string" && ALLOWED.has(c.method)
  );
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const net = searchParams.get("cluster") === "devnet" ? "devnet" : "mainnet";

  const upstream = heliusRpcUrl(net);
  if (!upstream) {
    return NextResponse.json({ error: "rpc unconfigured" }, { status: 503 });
  }

  let payload: unknown;
  let raw: string;
  try {
    raw = await req.text();
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!methodsAllowed(payload)) {
    return NextResponse.json({ error: "method not allowed" }, { status: 400 });
  }

  try {
    const res = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: raw,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    // Pass the upstream body + status straight through so web3.js sees a normal
    // JSON-RPC response.
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "upstream failed" }, { status: 502 });
  }
}
