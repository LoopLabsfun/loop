import { NextResponse } from "next/server";
import { getSolBalance, getSplBalance } from "@/lib/solana";
import { isSolanaAddress } from "@/lib/api-guards";
import type { Network } from "@/lib/solana";

export const dynamic = "force-dynamic";

// Live balance of a CONNECTED wallet — its SOL and (optionally) its holding of a
// given mint — read through Helius on the server, where the API key lives.
//
// Why this exists: the browser wallet-adapter connection falls back to the public
// `api.mainnet-beta.solana.com` RPC, which throttles / 403s browser-origin reads.
// That made `getTokenAccountsByOwner` fail in the trade panel, so a holder's real
// $LOOP balance read as 0 and "Sell · Max" couldn't be filled. Routing the read
// through this server proxy (Helius, no exposed key, sums across ALL the owner's
// token accounts — not just the ATA) makes the balance reliable. The cluster is
// chosen per request so devnet/mainnet projects both work.
//
// Read-only and tightly validated: owner + mint must be well-formed base58 and
// cluster is an enum, so this can't be steered into hammering an arbitrary
// upstream (same posture as the /api/market and /api/swap proxies).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const mint = searchParams.get("mint");
  const cluster = searchParams.get("cluster");

  if (!isSolanaAddress(owner)) {
    return NextResponse.json({ error: "owner required" }, { status: 400 });
  }
  if (mint !== null && !isSolanaAddress(mint)) {
    return NextResponse.json({ error: "invalid mint" }, { status: 400 });
  }
  const net: Network = cluster === "devnet" ? "devnet" : "mainnet";

  // null from either helper = unconfigured / RPC failure; the client treats that
  // as "fall back to the wallet-adapter connection read" rather than a hard 0.
  const [sol, token] = await Promise.all([
    getSolBalance(owner, net),
    isSolanaAddress(mint) ? getSplBalance(owner, mint, net) : Promise.resolve(null),
  ]);

  return NextResponse.json({ sol, token });
}
