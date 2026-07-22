import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyProfileProof, type LaunchProof } from "@/lib/signature";
import { isSolanaAddress } from "@/lib/api-guards";
import { issueUserToken, verifyUserToken, USER_COOKIE } from "@/lib/user-session";
import { limited } from "@/lib/rate-limit";
import { verifyEvmPersonalSign } from "@/lib/evm-signature";
import {
  buildEvmSignInMessage,
  normalizeEvmAddress,
  signInProofProblems,
  type EvmLinkProof,
} from "@/lib/evm-link-message";
import { supabaseAdmin } from "@/lib/supabase";

// Open a USER session, from EITHER wallet.
//
// The user signs once — the canonical `looplabs.fun profile` message with their
// Solana wallet, OR `looplabs.fun sign in` with an EVM wallet they've already
// proven belongs to their profile — and gets the same 7-day httpOnly session
// either way, so social actions (follow, notifications, DMs) don't re-prompt.
//
// The signature is NOT optional in either path: it is the login. Accepting a
// bare address would let anyone read anyone's private DMs by typing theirs.
// What the EVM path removes is the requirement to hold a SOLANA wallet to be
// recognised — not the requirement to prove who you are.
//
// Non-privileged: the cookie only ever authorizes actions on the signer's own
// identity.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Who the current session cookie belongs to (or null). The cookie is httpOnly so
// the client can't read the wallet from it directly — SessionSync calls this to
// detect a STALE session (cookie wallet ≠ connected wallet) and clear it, which
// is why follow/DM would otherwise act as a previously-connected wallet.
export async function GET() {
  const wallet = verifyUserToken(cookies().get(USER_COOKIE)?.value)?.wallet ?? null;
  return NextResponse.json({ wallet });
}

/**
 * Resolve the Loop identity behind an EVM address: the Solana wallet that
 * PROVED the link (lib/evm-link-message). The Solana wallet stays the root
 * identity — an EVM address is a credential FOR an account, never an account of
 * its own, so an unlinked address can't conjure one.
 *
 * Several profiles may legitimately link the same address (one person, several
 * Solana wallets), and only the EVM key holder can create those links — so
 * ambiguity is always self-inflicted, never an attack. We still refuse to guess
 * which identity was meant: picking one would silently sign someone into the
 * wrong account, with the wrong DMs.
 */
async function identityForEvm(
  address: string
): Promise<{ wallet: string } | { error: string; status: number }> {
  const sb = supabaseAdmin;
  if (!sb) return { error: "supabase not configured", status: 503 };
  const { data, error } = await sb
    .from("profiles")
    .select("wallet")
    .eq("evm_address", address)
    .limit(2);
  if (error) return { error: "could not resolve identity", status: 500 };
  const rows = (data ?? []) as { wallet: string }[];
  if (!rows.length) {
    return {
      error: "this address isn't linked to a Loop profile yet — link it from your Solana wallet first",
      status: 404,
    };
  }
  if (rows.length > 1) {
    return {
      error: "this address is linked to several Loop profiles — sign in with the Solana wallet instead",
      status: 409,
    };
  }
  return { wallet: rows[0].wallet };
}

export async function POST(req: Request) {
  const rl = limited("session", req, { limit: 15, windowMs: 60_000 });
  if (rl) return rl;
  let body: { wallet?: string; proof?: LaunchProof; evm?: EvmLinkProof };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  // ── EVM sign-in ───────────────────────────────────────────────────────────
  // Same session, same identity, whichever wallet the user happens to have
  // connected. The proof is still required — it IS the login — it just no
  // longer has to come from the Solana side.
  if (body.evm) {
    const evm = { ...body.evm, ts: Number(body.evm.ts) };
    const message = buildEvmSignInMessage(String(evm.address ?? ""), evm.ts);
    const problem = signInProofProblems(evm, message);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    const address = normalizeEvmAddress(evm.address);
    if (!verifyEvmPersonalSign(message, evm.signature, address)) {
      return NextResponse.json(
        { error: "that signature doesn't come from this EVM address" },
        { status: 401 }
      );
    }
    const identity = await identityForEvm(address);
    if ("error" in identity) {
      return NextResponse.json({ error: identity.error }, { status: identity.status });
    }
    const evmToken = issueUserToken(identity.wallet);
    if (!evmToken) {
      return NextResponse.json({ error: "user sessions not configured" }, { status: 503 });
    }
    const res = NextResponse.json({ ok: true, wallet: identity.wallet, via: "evm" });
    res.cookies.set(USER_COOKIE, evmToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    return res;
  }

  // ── Solana sign-in (unchanged) ────────────────────────────────────────────
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
  const token = issueUserToken(wallet);
  if (!token) {
    return NextResponse.json({ error: "user sessions not configured" }, { status: 503 });
  }
  const res = NextResponse.json({ ok: true, wallet });
  res.cookies.set(USER_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}

// Sign out — clear the session cookie.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
