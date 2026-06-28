// Client-safe constants + submit helper for the launch waitlist (a pre-launch
// project draft). Lives outside lib/waitlist (which is `server-only`) so the
// client form can import the shared caps + the submit call without pulling
// `server-only` into the browser bundle.

/** Field caps, shared by the client form (maxLength) and the server validator. */
export const IDEA_MAX = 280;
export const NAME_MAX = 60;
export const TICKER_MAX = 12;
export const PROMPT_MAX = 500;
export const REPO_MAX = 200;

// Type-only import — elided at compile, so this never bundles tweetnacl/signature.ts.
import type { LaunchProof } from "./signature";

export interface WaitlistDraft {
  name: string;
  ticker: string;
  prompt?: string | null;
  repo?: string | null;
  email?: string | null;
  xHandle?: string | null;
  idea?: string | null;
  referrer?: string | null;
  feeFounderPct?: number | null;
  banner?: File | null;
  tokenImage?: File | null;
}

export interface WaitlistResult {
  /** The wallet already had a draft (re-submit refines it). */
  already: boolean;
  /** A welcome DM was opened on-platform (first submit only). */
  messaged: boolean;
  /** Banner image stored. */
  banner: boolean;
  /** Token image stored. */
  tokenImage: boolean;
  /** The entry gate is armed and this first submit needs the on-chain toll paid:
   *  the caller should make the payments and re-submit with the sigs. */
  paymentRequired?: boolean;
}

/**
 * Submit a pre-launch draft. `wallet` + `proof` authenticate it (the wallet signed
 * the canonical waitlist message). Sent as multipart so the optional banner/token
 * images ride along in the ONE signed request (a single wallet popup).
 */
export async function apiJoinWaitlist(
  wallet: string,
  proof: LaunchProof,
  draft: WaitlistDraft,
  gate?: { feeSig?: string | null; loopSig?: string | null },
): Promise<WaitlistResult> {
  const fd = new FormData();
  fd.set("wallet", wallet);
  fd.set("proof", JSON.stringify(proof));
  fd.set("name", draft.name);
  fd.set("ticker", draft.ticker);
  for (const [k, v] of [
    ["prompt", draft.prompt],
    ["repo", draft.repo],
    ["email", draft.email],
    ["xHandle", draft.xHandle],
    ["idea", draft.idea],
    ["referrer", draft.referrer],
    ["gateFeeSig", gate?.feeSig],
    ["gateLoopSig", gate?.loopSig],
  ] as const) {
    if (v) fd.set(k, v);
  }
  if (draft.feeFounderPct != null) fd.set("feeFounderPct", String(draft.feeFounderPct));
  if (draft.banner) fd.set("banner", draft.banner);
  if (draft.tokenImage) fd.set("tokenImage", draft.tokenImage);

  const r = await fetch("/api/waitlist", { method: "POST", body: fd });
  const j = await r.json().catch(() => ({}));
  // The gate signals "pay first" with a 402 + paymentRequired — not a hard error;
  // surface it so the caller can make the toll payments and re-submit with sigs.
  if (!r.ok && !j.paymentRequired) throw new Error(j.error || "Could not save your pre-launch.");
  return {
    already: Boolean(j.already),
    messaged: Boolean(j.messaged),
    banner: Boolean(j.banner),
    tokenImage: Boolean(j.tokenImage),
    paymentRequired: Boolean(j.paymentRequired),
  };
}
