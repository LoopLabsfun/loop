import { NextResponse } from "next/server";
import { joinWaitlist } from "@/lib/waitlist";
import { uploadWaitlistMedia } from "@/lib/waitlist-upload";
import { verifyWaitlistProof, type LaunchProof } from "@/lib/signature";
import { isSolanaAddress } from "@/lib/api-guards";
import { limited } from "@/lib/rate-limit";

// Pre-launch a project (the launch waitlist). The wallet signs the canonical
// `looplabs.fun — pre-launch a project` message; we verify the ed25519 signature
// is genuine + recent AND that the signer IS the wallet, then (best-effort) upload
// any banner/token image and save the draft. Multipart so the images ride along in
// ONE signed request (a single wallet popup). Service-role write happens in
// lib/waitlist; the list is never publicly readable.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function str(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function fileOf(form: FormData, key: string): File | null {
  const v = form.get(key);
  return v && typeof v === "object" && "arrayBuffer" in v ? (v as File) : null;
}

export async function POST(req: Request) {
  const rl = limited("waitlist", req, { limit: 8, windowMs: 60_000 });
  if (rl) return rl;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const wallet = str(form, "wallet");
  let proof: LaunchProof | null = null;
  try {
    const raw = str(form, "proof");
    proof = raw ? (JSON.parse(raw) as LaunchProof) : null;
  } catch {
    proof = null;
  }

  if (!isSolanaAddress(wallet)) {
    return NextResponse.json({ error: "Connect a wallet to pre-launch." }, { status: 400 });
  }
  if (!proof?.pubkey || !proof.signature || !proof.message) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }
  if (proof.pubkey !== wallet || !verifyWaitlistProof(proof, wallet)) {
    return NextResponse.json({ error: "signature does not prove this wallet" }, { status: 401 });
  }

  // Upload images in parallel — best-effort: an oversized/failed image (or a
  // pre-migration missing bucket) returns null and never blocks the draft.
  const banner = fileOf(form, "banner");
  const tokenImage = fileOf(form, "tokenImage");
  const [bannerUrl, tokenImageUrl] = await Promise.all([
    banner ? uploadWaitlistMedia(wallet, "banner", banner) : Promise.resolve(null),
    tokenImage ? uploadWaitlistMedia(wallet, "token", tokenImage) : Promise.resolve(null),
  ]);

  const feeRaw = str(form, "feeFounderPct");
  const r = await joinWaitlist(wallet, {
    name: str(form, "name"),
    ticker: str(form, "ticker"),
    prompt: str(form, "prompt"),
    repo: str(form, "repo"),
    email: str(form, "email"),
    xHandle: str(form, "xHandle"),
    idea: str(form, "idea"),
    referrer: str(form, "referrer"),
    feeFounderPct: feeRaw == null ? null : Number(feeRaw),
    bannerUrl,
    tokenImageUrl,
  }, {
    // Entry-gate payment sigs (the first submit pays SOL fee + 1M $LOOP). Verified
    // on-chain in joinWaitlist; ignored unless the gate is armed.
    feeSig: str(form, "gateFeeSig"),
    loopSig: str(form, "gateLoopSig"),
  });
  if (!r.ok) {
    // 402 when the entry gate needs the toll paid first (the client then pays + re-submits).
    return NextResponse.json(
      { error: r.error ?? "failed", paymentRequired: Boolean(r.paymentRequired) },
      { status: r.paymentRequired ? 402 : 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    already: Boolean(r.already),
    messaged: Boolean(r.messaged),
    banner: Boolean(bannerUrl),
    tokenImage: Boolean(tokenImageUrl),
  });
}
