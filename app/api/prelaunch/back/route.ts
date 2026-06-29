import { NextResponse } from "next/server";
import { resolveDraftWalletBySlug } from "@/lib/prelaunch-public";
import { syncPrelaunchContributions, getPrelaunchFunding } from "@/lib/prelaunch";

// PUBLIC pre-launch backing reconcile. After a backer sends SOL to a whitelisted
// draft's deposit wallet (client-side), the UI POSTs the project's public slug
// here to fold the new on-chain transfer into the contribution ledger — so the
// "X SOL · N backers" social proof updates without a founder running the admin
// sync. Safe by construction: it never trusts a client-supplied amount/sender —
// syncPrelaunchContributions re-reads transfers from the chain (service role,
// deduped by tx_sig), and the slug only maps to a whitelisted draft. The draft
// (proposer) wallet is resolved server-side and never returned.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { slug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const slug = (body.slug || "").trim();
  if (!/^[a-z0-9]{1,40}$/.test(slug)) {
    return NextResponse.json({ error: "valid slug required" }, { status: 400 });
  }
  const draftWallet = await resolveDraftWalletBySlug(slug);
  if (!draftWallet) {
    return NextResponse.json({ error: "no whitelisted pre-launch for that slug" }, { status: 404 });
  }
  const added = await syncPrelaunchContributions(draftWallet);
  const funding = await getPrelaunchFunding(draftWallet);
  return NextResponse.json({
    ok: true,
    added,
    totalSol: funding.totalSol,
    backers: funding.backers,
  });
}
