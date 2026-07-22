import { NextResponse } from "next/server";
import { launchFeeLamports, launchFeeRequired, launchFeeWallet } from "@/lib/launch-fee";
import { providerForChain } from "@/lib/launchpad";

// What a launch costs, read from the SAME module that enforces it server-side
// (lib/launch-fee).
//
// The obvious alternative — mirroring the amount into NEXT_PUBLIC_LAUNCH_FEE_*
// — has a failure mode that costs users real money: the moment the public copy
// and the server value drift, the client pays one amount and the server rejects
// it for being under the other. The user is out the SOL and has nothing to show
// for it. There is no second copy to drift here: the client asks what to pay,
// and the answer comes from the enforcing code itself.
//
// Public on purpose: it's a price and a destination address, both of which the
// payer must know before paying. Nothing here is a secret.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LAMPORTS_PER_SOL = 1_000_000_000;

export async function GET() {
  const lamports = launchFeeLamports();
  const tolled = launchFeeRequired();
  // Whether THIS deployment can actually launch on Hood: a Pons provider armed
  // for that chain, a wallet to send from, and the toll (see below — a Hood
  // launch spends platform ETH, so it must not be free).
  const hoodReady =
    providerForChain("hood") === "pons" &&
    Boolean(process.env.HOOD_LAUNCH_WALLET_ID && process.env.HOOD_LAUNCH_WALLET_ADDRESS) &&
    tolled;
  return NextResponse.json(
    {
      required: tolled,
      wallet: launchFeeWallet(),
      lamports: lamports.toString(),
      sol: Number(lamports) / LAMPORTS_PER_SOL,
      hoodReady,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
