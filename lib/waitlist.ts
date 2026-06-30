import "server-only";
import { supabaseAdmin } from "./supabase";
import { sendDm } from "./dm";
import { makeSplit, DEFAULT_SPLIT } from "./fees";
import { verifySolPayment, verifySplPayment } from "./solana";
import { parseCluster } from "./launchpad";
import {
  gateRequired,
  gateFeeRequired,
  gateLoopRequired,
  gateFeeLamports,
  gateLoopAmount,
  gateWallet,
  gateLoopMint,
} from "./prelaunch-gate";

// Launch waitlist — now a real "pre-launch your project" draft, mirroring the
// official launch form (LaunchModal): name, ticker, banner, token image, fee
// split, the build prompt. Submit is wallet-signed at the API boundary (creates
// an account), so the wallet is the authenticated session wallet — never trusted
// from the body. Service-role write only (the /api/waitlist route); the table is
// RLS-locked with no read policy, so contact details are never publicly readable.
// Validators are pure + exported for unit tests.

export { IDEA_MAX, NAME_MAX, TICKER_MAX, PROMPT_MAX, REPO_MAX } from "./waitlist-client";
import { IDEA_MAX, NAME_MAX, PROMPT_MAX, REPO_MAX } from "./waitlist-client";

export const URL_MAX = 400;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const X_RE = /^[A-Za-z0-9_]{1,15}$/; // X handles: 1–15 of [A-Za-z0-9_]
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TICKER_RE = /^[A-Z0-9]{1,12}$/;

export interface WaitlistInput {
  email?: string | null;
  xHandle?: string | null;
  idea?: string | null;
  referrer?: string | null;
  name?: string | null;
  ticker?: string | null;
  bannerUrl?: string | null;
  tokenImageUrl?: string | null;
  feeFounderPct?: number | null;
  prompt?: string | null;
  repo?: string | null;
}

export interface CleanDraft {
  name: string;
  ticker: string;
  email: string | null;
  xHandle: string | null;
  idea: string | null;
  referrer: string | null;
  bannerUrl: string | null;
  tokenImageUrl: string | null;
  feeFounderPct: number;
  prompt: string | null;
  repo: string | null;
}

export function normalizeEmail(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().toLowerCase();
  return t && EMAIL_RE.test(t) && t.length <= 254 ? t : null;
}

export function normalizeXHandle(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/^@/, "");
  return t && X_RE.test(t) ? t : null;
}

export function normalizeTicker(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/^\$/, "").toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

function normalizeWallet(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return BASE58.test(t) ? t : null;
}

/** Only accept image URLs we minted ourselves (our public storage bucket) so the
 *  draft can't be used to store an arbitrary off-platform link. Falls back to any
 *  https URL when the Supabase URL isn't configured (local/test). */
export function normalizeMediaUrl(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || t.length > URL_MAX || !/^https:\/\//i.test(t)) return null;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  if (base) {
    const prefix = `${base}/storage/v1/object/public/waitlist-media/`;
    return t.startsWith(prefix) ? t : null;
  }
  return t;
}

function cap(s: unknown, n: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, n) : null;
}

/**
 * Validate + clean a project draft. Name and ticker are required (mirrors the
 * launch form); everything else is optional. Returns `error` when a required
 * field is missing. The fee split is clamped through makeSplit so it's always a
 * valid founder share.
 */
export function validateWaitlist(input: WaitlistInput): { clean?: CleanDraft; error?: string } {
  const name = cap(input.name, NAME_MAX);
  if (!name) return { error: "Project name is required." };
  const ticker = normalizeTicker(input.ticker);
  if (!ticker) return { error: "A ticker is required (letters/numbers, up to 12)." };

  const founder =
    input.feeFounderPct == null || !Number.isFinite(Number(input.feeFounderPct))
      ? DEFAULT_SPLIT.founderPct
      : makeSplit(Number(input.feeFounderPct)).founderPct;

  return {
    clean: {
      name,
      ticker,
      email: normalizeEmail(input.email),
      xHandle: normalizeXHandle(input.xHandle),
      idea: cap(input.idea, IDEA_MAX),
      referrer: normalizeWallet(input.referrer) ?? normalizeXHandle(input.referrer),
      bannerUrl: normalizeMediaUrl(input.bannerUrl),
      tokenImageUrl: normalizeMediaUrl(input.tokenImageUrl),
      feeFounderPct: founder,
      prompt: cap(input.prompt, PROMPT_MAX),
      repo: cap(input.repo, REPO_MAX),
    },
  };
}

/** The wallet the welcome DM is sent FROM (and the admin recap is sent TO) — the
 *  official Loop account. Resolution: WAITLIST_DM_SENDER (explicit override) → the
 *  LOOP project's creator wallet (the profiled official account, "Loop"). Deliberately
 *  NOT PLATFORM_WALLET — that's the fee-collection sink, never a social identity;
 *  conflating them once made the welcome DM arrive from an anonymous fee wallet and
 *  buried the recap in an inbox nobody connects as. null ⇒ skip the DM (signup
 *  still works). */
async function dmSender(): Promise<string | null> {
  const override = (process.env.WAITLIST_DM_SENDER || "").trim();
  if (BASE58.test(override)) return override;
  const sb = supabaseAdmin;
  if (!sb) return null;
  const { data } = await sb
    .from("projects")
    .select("creator_wallet")
    .eq("key", "loop")
    .maybeSingle();
  const w = ((data?.creator_wallet as string | undefined) ?? "").trim();
  return BASE58.test(w) ? w : null;
}

/** First-contact DM body. Echoes the project + pitch back so the conversation
 *  starts with what THEY care about. Pure + exported for tests. */
export function welcomeDmBody(name: string, pitch: string | null): string {
  const intro = `Welcome to Loop 👋 You pre-launched ${name} — you're on the launch list and first in when the factory opens.`;
  return pitch
    ? `${intro}\n\nYou want the agent to build:\n"${pitch}"\n\nWhat's the first thing it should ship? Reply here — we read every one.`
    : `${intro}\n\nTell me more about ${name} — what should the agent build first? Reply here, we read every one.`;
}

/** The full draft as a recap message dropped into the ADMIN's inbox (sent from the
 *  applicant's wallet to the official account, so it sits in the same thread as the
 *  welcome DM) — so the complete request is retrievable on-platform, not just in the
 *  DB. Pure + exported for tests. sendDm caps the length, but keep it tight. */
export function adminRecapBody(wallet: string, d: CleanDraft): string {
  const split = makeSplit(d.feeFounderPct);
  return [
    `🚀 Pre-launch request: ${d.name} ($${d.ticker})`,
    "",
    `Build: ${d.prompt ?? "—"}`,
    `Repo: ${d.repo ?? "—"}`,
    `Fee split (founder/agent/platform): ${split.founderPct}/${split.agentPct}/${split.platformPct}`,
    `Banner: ${d.bannerUrl ?? "—"}`,
    `Token image: ${d.tokenImageUrl ?? "—"}`,
    `Contact: ${d.email ?? "—"}${d.xHandle ? `  @${d.xHandle}` : ""}`,
    `From: ${wallet}`,
  ].join("\n");
}

/**
 * Save a wallet's pre-launch draft. `wallet` is the authenticated session wallet
 * (the route enforces the signature), so it's trusted here. Ensures the account
 * exists (a profile row), upserts the draft (re-submitting refines it), and on the
 * FIRST submit opens a welcome DM from the official account so first contact
 * happens on our own platform (best-effort — never fails the submit).
 */
export async function joinWaitlist(
  wallet: string,
  input: WaitlistInput,
  gate?: { feeSig?: string | null; loopSig?: string | null },
): Promise<{ ok: boolean; error?: string; already?: boolean; messaged?: boolean; paymentRequired?: boolean }> {
  if (!normalizeWallet(wallet)) return { ok: false, error: "Invalid wallet." };
  const { clean, error } = validateWaitlist(input);
  if (!clean) return { ok: false, error };
  const sb = supabaseAdmin;
  if (!sb) return { ok: false, error: "Waitlist is not configured yet." };

  // Signing in IS creating the account: make sure a profile row exists (never
  // clobber an existing one — ignoreDuplicates).
  await sb.from("profiles").upsert({ wallet }, { onConflict: "wallet", ignoreDuplicates: true });

  // Legacy columns only — the fallback if the draft columns aren't migrated yet,
  // so a deploy that lands before the migration still captures the lead + DM
  // (just without name/ticker/images/split). The pitch is preserved as `idea`.
  const legacyRow = {
    wallet,
    email: clean.email,
    x_handle: clean.xHandle,
    idea: clean.idea ?? clean.prompt,
    referrer: clean.referrer,
  };
  const draftRow = {
    ...legacyRow,
    idea: clean.idea,
    name: clean.name,
    ticker: clean.ticker,
    banner_url: clean.bannerUrl,
    token_image_url: clean.tokenImageUrl,
    fee_founder_pct: clean.feeFounderPct,
    prompt: clean.prompt,
    repo: clean.repo,
    updated_at: new Date().toISOString(),
  };

  // Update-or-insert keyed by the wallet's ACTIVE row only (draft/whitelisted) —
  // a partial unique index enforces at most one active row per wallet, so
  // .maybeSingle() is safe. A wallet that has already LAUNCHED (or been
  // rejected) has no active row, so it falls through to a fresh INSERT below: a
  // launched founder can pitch a second, distinct project instead of being
  // permanently locked out after their first. Scoping the lookup to the active
  // row (not "any row for this wallet") is also what stops the corruption bug
  // this replaces — a resubmit can never again touch an already-launched row's
  // content, because that row simply won't match.
  const { data: active } = await sb
    .from("launch_waitlist")
    .select("id, status")
    .eq("wallet", wallet)
    .in("status", ["draft", "whitelisted"])
    .maybeSingle();
  const already = Boolean(active);
  const activeId = (active as { id?: number } | null)?.id;

  // Within the active row, only `draft` is self-service editable here — once
  // whitelisted, the admin already approved this exact pitch, and further edits
  // go through the admin-mediated updatePrelaunchDraft, not this public route.
  const activeStatus = (active as { status?: string } | null)?.status;
  if (activeStatus === "whitelisted") {
    return { ok: false, error: "This wallet's draft is already in review — it can no longer be edited here." };
  }

  // Entry gate: the FIRST submit pays the toll (SOL fee + 1M $LOOP to the platform),
  // verified on-chain. Refining an existing draft is free. Off until the founder
  // arms it (gateRequired() false by default) — the current free submit stays.
  const gateSigs: Record<string, string> = {};
  if (!already && gateRequired()) {
    const to = gateWallet();
    if (!to) return { ok: false, error: "Submission gate is misconfigured." };
    const net = parseCluster(process.env.LAUNCH_CLUSTER);
    if (gateFeeRequired()) {
      const sig = gate?.feeSig?.trim();
      // No sig yet → tell the client to pay (paymentRequired). Sig present but
      // unverifiable → a plain error (don't make them pay twice; likely lag).
      if (!sig) return { ok: false, paymentRequired: true, error: "Pay the SOL submission fee to continue." };
      const paid = await verifySolPayment(sig, { from: wallet, to, minLamports: gateFeeLamports(), net });
      if (!paid) return { ok: false, error: "SOL fee payment not found or not confirmed yet — retry in a moment." };
      gateSigs.gate_fee_sig = sig;
    }
    if (gateLoopRequired()) {
      const sig = gate?.loopSig?.trim();
      const mint = gateLoopMint();
      if (!sig) return { ok: false, paymentRequired: true, error: "Pay 1,000,000 $LOOP to continue." };
      if (!mint) return { ok: false, error: "Submission gate is misconfigured (no $LOOP mint)." };
      const paid = await verifySplPayment(sig, { from: wallet, to, mint, minUiAmount: gateLoopAmount(), net });
      if (!paid) return { ok: false, error: "$LOOP payment not found or not confirmed yet — retry in a moment." };
      gateSigs.gate_loop_sig = sig;
    }
  }

  // Scoped by id (not wallet) — a wallet can now have past terminal rows
  // alongside the current active one, and an unscoped `.eq("wallet", wallet)`
  // update would touch ALL of them, re-corrupting an already-launched row.
  const write = (r: Record<string, unknown>) =>
    activeId != null
      ? sb.from("launch_waitlist").update(r).eq("id", activeId)
      : sb.from("launch_waitlist").insert(r);

  let { error: dbErr } = await write({ ...draftRow, ...gateSigs });
  // 42703 = undefined column → the draft columns aren't migrated yet; degrade to
  // the legacy shape so the lead is still captured (full data lights up post-migration).
  if (dbErr && (dbErr.code === "42703" || /column .* does not exist/i.test(dbErr.message))) {
    ({ error: dbErr } = await write(legacyRow));
  }
  if (dbErr) {
    // 23505 = a unique violation. Distinguish a reused gate payment from a dup email.
    if (dbErr.code === "23505" || /duplicate|unique/i.test(dbErr.message)) {
      const blob = `${dbErr.message} ${(dbErr as { details?: string }).details ?? ""}`;
      if (/gate_(fee|loop)_sig/.test(blob)) {
        return { ok: false, error: "That payment was already used for another request." };
      }
      if (/wallet/i.test(blob)) {
        // Race: two concurrent submits both saw "no active row" for this wallet.
        return { ok: false, error: "This wallet already has a draft in progress — refresh and try again." };
      }
      return { ok: false, error: "That email is already on the list." };
    }
    return { ok: false, error: dbErr.message };
  }

  let messaged = false;
  if (!already) {
    const sender = await dmSender();
    if (sender && sender !== wallet) {
      try {
        const r = await sendDm(sender, wallet, welcomeDmBody(clean.name, clean.prompt ?? clean.idea));
        messaged = r.ok;
        // Drop the full request into the official account's inbox (from the applicant,
        // so it's the same thread as the welcome) — the complete ask is retrievable on-platform.
        await sendDm(wallet, sender, adminRecapBody(wallet, clean));
      } catch {
        /* best-effort: a DM failure must never break the submit */
      }
    }
  }
  return { ok: true, already, messaged };
}

export interface PrelaunchSummary {
  name: string;
  ticker: string;
  /** draft | whitelisted | launched | rejected */
  status: string;
  bannerUrl: string | null;
  tokenImageUrl: string | null;
  prompt: string | null;
  feeFounderPct: number | null;
  /** Proposer's X handle (bare, no @) — public, threaded into the token's socials. */
  xHandle: string | null;
  /** Set once the draft has been launched into a real project. */
  projectKey: string | null;
  createdAt: string;
}

/** A wallet's pre-launch draft for display (profile card), or null if none. Only
 *  non-sensitive fields — never email/referrer. Best-effort: cold backend ⇒ null. */
export async function getPrelaunch(wallet: string): Promise<PrelaunchSummary | null> {
  const sb = supabaseAdmin;
  if (!sb) return null;
  const { data } = await sb
    .from("launch_waitlist")
    .select("name,ticker,status,banner_url,token_image_url,prompt,fee_founder_pct,x_handle,project_key,created_at")
    .eq("wallet", wallet)
    .not("name", "is", null)
    .maybeSingle();
  if (!data?.name) return null;
  return {
    name: data.name,
    ticker: data.ticker ?? "",
    status: data.status ?? "draft",
    bannerUrl: data.banner_url ?? null,
    tokenImageUrl: data.token_image_url ?? null,
    prompt: data.prompt ?? null,
    feeFounderPct: data.fee_founder_pct ?? null,
    xHandle: data.x_handle ?? null,
    projectKey: data.project_key ?? null,
    createdAt: data.created_at,
  };
}
