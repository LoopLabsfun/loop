import { NextResponse } from "next/server";
import { verifyProfileProof, type LaunchProof } from "@/lib/signature";
import { verifyEvmPersonalSign } from "@/lib/evm-signature";
import {
  buildEvmLinkMessage,
  linkProofProblems,
  normalizeEvmAddress,
  type EvmLinkProof,
} from "@/lib/evm-link-message";
import { isSolanaAddress } from "@/lib/api-guards";
import { supabaseAdmin } from "@/lib/supabase";
import { limited } from "@/lib/rate-limit";

// Attach an EVM (Robinhood Chain) address to a profile — or detach it.
//
// TWO signatures, proving two different things, and BOTH are required:
//   • the Solana proof says WHO is editing (same `looplabs.fun profile` proof
//     the rest of the profile editor uses, signer must equal the wallet);
//   • the EVM proof says the address given is one the user can actually SIGN
//     FOR. This is the one that matters: an EVM address is a destination, and a
//     pasted exchange address or a one-character typo is accepted silently by
//     every system that doesn't check, then discovered only when funds sent
//     there can't be recovered.
//
// The EVM message is rebuilt server-side from (wallet, address, ts) and compared
// to what was signed, so the client never gets to choose the text it signs.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const rl = limited("profile-evm", req, { limit: 10, windowMs: 60_000 });
  if (rl) return rl;

  let body: {
    wallet?: string;
    proof?: LaunchProof;
    evm?: EvmLinkProof;
    /** true ⇒ clear the link (still requires the Solana proof). */
    unlink?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const wallet = body.wallet;
  const proof = body.proof;
  if (!isSolanaAddress(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  if (!proof?.pubkey || !proof.signature || !proof.message) {
    return NextResponse.json({ error: "missing proof" }, { status: 400 });
  }
  if (proof.pubkey !== wallet || !verifyProfileProof(proof, wallet)) {
    return NextResponse.json({ error: "signature does not prove this wallet" }, { status: 401 });
  }

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  // Unlink: the Solana proof alone is enough — removing your own address is
  // never destructive to anyone else.
  if (body.unlink) {
    const { error } = await sb
      .from("profiles")
      .upsert(
        {
          wallet,
          evm_address: null,
          evm_proof_sig: null,
          evm_proof_ts: null,
          evm_linked_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet" }
      );
    if (error) return NextResponse.json({ error: "could not unlink" }, { status: 500 });
    return NextResponse.json({ ok: true, evmAddress: null });
  }

  const evm = body.evm;
  if (!evm) return NextResponse.json({ error: "missing EVM proof" }, { status: 400 });

  // Rebuild the message OURSELVES — never trust one supplied by the caller.
  const message = buildEvmLinkMessage(wallet, String(evm.address ?? ""), Number(evm.ts));
  const problem = linkProofProblems(wallet, { ...evm, ts: Number(evm.ts) }, message);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const address = normalizeEvmAddress(evm.address);
  if (!verifyEvmPersonalSign(message, evm.signature, address)) {
    return NextResponse.json(
      { error: "that signature doesn't come from this EVM address" },
      { status: 401 }
    );
  }

  const { error } = await sb.from("profiles").upsert(
    {
      wallet,
      evm_address: address,
      evm_proof_sig: evm.signature.slice(0, 200),
      evm_proof_ts: Number(evm.ts),
      evm_linked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "wallet" }
  );
  if (error) return NextResponse.json({ error: "could not save" }, { status: 500 });

  return NextResponse.json({ ok: true, evmAddress: address });
}
