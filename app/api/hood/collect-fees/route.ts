import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { verifyCollectTx, readCollectableFees, readFeeRecipient } from "@/lib/chains/pons-fees";
import { recordSweepToLedger, getFeeLedger } from "@/lib/fee-ledger-store";
import { makeSplit } from "@/lib/fees";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The Hood half of the self-funding loop.
 *
 * GET  — how much is collectable right now for a Hood project, and where the
 *        creator share is routed. Read-only; powers the treasury card's
 *        "Collect fees" button (amount + a proof of the recipient).
 * POST — record a collect the founder ALREADY signed. The browser sends only a
 *        tx hash: the amount is re-derived from the chain's FeesClaimed log
 *        (verifyCollectTx), never trusted from the client, then split 30/65/5
 *        into the same fee_ledger the Solana side writes to.
 *
 * No signing happens here — the founder's own wallet sends the collect. This
 * route only verifies and accounts for it.
 */

async function hoodProject(key: string) {
  const p = await getProject(key);
  if (!p || (p.chain ?? "solana") !== "hood" || !p.mint) return null;
  return p;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = (searchParams.get("project") || "loop-hood").slice(0, 64);
  const p = await hoodProject(key);
  if (!p) return NextResponse.json({ error: "not a live Hood project" }, { status: 404 });

  const treasury = p.treasuryWallet ?? "";
  const [fees, recipient, ledger] = await Promise.all([
    treasury ? readCollectableFees(p.mint as string, treasury) : Promise.resolve(null),
    readFeeRecipient(p.mint as string),
    getFeeLedger(key),
  ]);
  // A zero redirect means the locker pays the launch deployer — which IS our
  // treasury, since the treasury sent the launch. Surface the effective one.
  const zero = "0x0000000000000000000000000000000000000000";
  const effectiveRecipient = !recipient || recipient === zero ? treasury : recipient;
  return NextResponse.json(
    {
      projectKey: key,
      token: p.mint,
      treasury,
      feeRecipient: effectiveRecipient,
      routedToTreasury:
        Boolean(treasury) && effectiveRecipient.toLowerCase() === treasury.toLowerCase(),
      protocolPct: fees?.protocolPct ?? null,
      collectableWei: fees ? fees.wethWei.toString() : "0",
      treasuryEth: fees ? Number(fees.treasuryWethWei) / 1e18 : 0,
      ledger,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  let body: { txHash?: string; project?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const key = (body.project || "loop-hood").slice(0, 64);
  const txHash = (body.txHash || "").trim();
  const p = await hoodProject(key);
  if (!p) return NextResponse.json({ error: "not a live Hood project" }, { status: 404 });

  const claimed = await verifyCollectTx(txHash);
  if (!claimed) {
    return NextResponse.json(
      { error: "no verified collect in that transaction" },
      { status: 422 }
    );
  }
  // The log must be for THIS project's token — otherwise a collect on some
  // other Pons launch would credit our ledger.
  if (claimed.token.toLowerCase() !== (p.mint as string).toLowerCase()) {
    return NextResponse.json({ error: "collect is for a different token" }, { status: 422 });
  }

  const eth = Number(claimed.recipientWethWei) / 1e18;
  if (!(eth > 0)) {
    return NextResponse.json({ ok: true, recordedEth: 0, note: "nothing landed on the recipient" });
  }
  // Same split the Solana sweep uses — the ledger's native-unit columns hold
  // ETH for a Hood project, exactly as treasury_sol does.
  const ledger = await recordSweepToLedger(key, eth, makeSplit(p.feeFounderPct ?? 30));
  return NextResponse.json(
    { ok: true, recordedEth: eth, token: claimed.token, ledger },
    { headers: { "Cache-Control": "no-store" } }
  );
}
