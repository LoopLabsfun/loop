"use server";

import { supabase, supabaseAdmin } from "./supabase";
import type { LaunchInput, LaunchResult } from "./api";
import { sanitizeLaunch, slugify, DESCRIPTION_MAX } from "./launch";
import { provisionPlan } from "./provisioning";
import { createToken, parseCluster } from "./launchpad";
import { verifyLaunchProof, verifyDirectiveProof, type LaunchProof } from "./signature";
import { sanitizeDirectiveText, isSuspiciousDirective } from "./directives";
import { launchesOpen, LAUNCHES_CLOSED_MESSAGE } from "./launch-config";

/**
 * Persist a newly launched project.
 *
 * In simulated mode (no LAUNCHPAD_PROVIDER configured) `createToken` is a no-op
 * — no mint/treasury wallet — so the row is inserted with the anon client and
 * stays within the locked-down `projects` RLS insert policy. With a real
 * provider configured, the token is minted on-chain and the resulting
 * mint/treasury_wallet are persisted via the service-role client (which the
 * anon insert policy forbids).
 *
 * Pay-to-launch (no stake toll): the bonding-curve buy is the cost and seeds
 * the treasury — there's no LOOP holding to verify. Still TODO for real launch:
 * collect the launch payment / curve buy on-chain before minting.
 */
export async function launchProjectAction(
  input: LaunchInput
): Promise<LaunchResult> {
  // Phase A (LOOP-only): public launches are closed. The founder creates LOOP
  // via the service-role launch script, not this action, so this never blocks
  // the LOOP mainnet deploy. Authoritative gate (the UI also reflects it, and
  // RLS forbids anon inserts) — reopen with NEXT_PUBLIC_LAUNCHES_OPEN=true.
  if (!launchesOpen()) {
    throw new Error(LAUNCHES_CLOSED_MESSAGE);
  }

  const clean = sanitizeLaunch(input);
  const ticker = "$" + clean.ticker;
  let key = slugify(clean.ticker, clean.name);

  // Wallet ownership proof. If the client supplied a signature it MUST verify
  // (a forged/replayed one is rejected); the verified pubkey is recorded as the
  // creator. Absent proof is allowed in prototype mode — wallets that can't
  // signMessage still launch — and will become required alongside on-chain
  // launch-payment verification.
  let creatorWallet: string | null = null;
  if (input.proof) {
    if (!verifyLaunchProof(input.proof, clean.ticker)) {
      throw new Error("Wallet signature could not be verified. Please retry.");
    }
    creatorWallet = input.proof.pubkey;
  }

  // The UI network switch selects the cluster; fall back to LAUNCH_CLUSTER.
  const cluster = input.network ?? parseCluster(process.env.LAUNCH_CLUSTER);

  // Pay-to-launch (not stake-to-launch): launching is open to anyone — no
  // LOOP-holding toll. The pump.fun bonding-curve buy is the cost and seeds the
  // project treasury; Loop earns via its 5% of the creator-fee split. Holding
  // LOOP is a governance + boost (default model tier), never a gate to publish.

  // Mint the token (no-op in simulated mode).
  const token = await createToken({
    name: clean.name,
    ticker: clean.ticker,
    prompt: clean.prompt,
    cluster,
  });

  const result: LaunchResult = {
    key,
    ticker,
    launchpad: token.launchpad,
    mint: token.mint,
    network: token.cluster,
  };

  if (!supabase) return result;

  // A real launch writes a mint/treasury_wallet, which the anon insert policy
  // rejects — those must go through the service-role client.
  const db = token.mint ? supabaseAdmin : supabase;
  if (token.mint && !supabaseAdmin) {
    throw new Error(
      "Real launch requires SUPABASE_SERVICE_ROLE_KEY to persist the mint."
    );
  }

  // Avoid colliding with an existing key.
  const { data: existing } = await db!
    .from("projects")
    .select("key")
    .eq("key", key)
    .maybeSingle();
  if (existing) {
    key = `${key}-${Date.now().toString(36).slice(-4)}`;
    result.key = key;
  }

  await db!.from("projects").insert({
    key,
    name: clean.name,
    ticker,
    description: clean.prompt.slice(0, DESCRIPTION_MAX),
    official: false,
    launchpad: token.launchpad,
    // White-label by default: no personal repo supplied ⇒ the project builds
    // under the Loop-owned org (LoopLabsfun/<slug>), never the operator's account.
    repo: clean.repo || provisionPlan(key).repo,
    cover: "neon",
    prompt: clean.prompt,
    price: 0.00003,
    market_cap: "$30K",
    liquidity: "$4K",
    holders: "1",
    volume_24h: "0 SOL",
    curve: 0.02,
    supply: "1B",
    treasury_sol: 0,
    earned_sol: 0,
    burn_per_day: "0.00 SOL/day",
    runway: "booting",
    // Real-launch fields; null/default in simulated mode (RLS-safe).
    mint: token.mint,
    treasury_wallet: token.treasuryWallet,
    network: token.cluster,
    creator_wallet: creatorWallet,
    // Founder's creator-fee share (agent gets the rest after the 5% platform cut).
    fee_founder_pct: clean.feeFounderPct,
    // Deep steering: guardrails + content policy the agent rereads each cycle.
    guardrails: clean.guardrails || null,
    content_policy: clean.contentPolicy || null,
  });

  return result;
}

export interface DirectiveInput {
  projectKey: string;
  text: string;
  /** "directive" (a founder-style instruction) or "proposal" (holder vote). */
  kind?: "directive" | "proposal";
  /** Connected wallet, recorded as the author when available. */
  authorWallet?: string | null;
  /**
   * Optional ed25519 proof the author owns `authorWallet` (signs the canonical
   * directive message). Recorded as a VERIFIED author only if it checks out;
   * without it the wallet is an unproven claim and is dropped (never attributed).
   */
  proof?: LaunchProof;
}

export interface DirectiveResult {
  ok: boolean;
  /** False when persistence is unavailable (the UI keeps its optimistic item). */
  persisted: boolean;
  error?: string;
}

/**
 * Persist a steering directive submitted from the Agent Console. Every submission
 * lands as an `open`, `holder`-role row with zeroed tallies (RLS-enforced), so it
 * is NEVER authoritative — the agent treats console directives as untrusted
 * suggestions, and promoting one to applied/adopted is a runtime/service_role
 * action. Two hardening rules close the spoofing/injection vector:
 *
 *  1. An author wallet is recorded (and shown) ONLY with a valid signature proof;
 *     a verified row is written via service_role (anon RLS forbids it). Without
 *     proof the wallet claim is dropped — no more forged "— <founder wallet>".
 *  2. Text matching a prompt-injection pattern is rejected outright, so the feed
 *     can't be stuffed with fake system/sign-off framing.
 */
export async function submitDirectiveAction(
  input: DirectiveInput
): Promise<DirectiveResult> {
  const text = sanitizeDirectiveText(input.text ?? "");
  if (!text) return { ok: false, persisted: false, error: "Directive is empty." };
  if (!input.projectKey) {
    return { ok: false, persisted: false, error: "Missing project." };
  }
  if (isSuspiciousDirective(text)) {
    return {
      ok: false,
      persisted: false,
      error:
        "Directive rejected. Steer in plain language — directives can't contain wallet addresses or override instructions. On-chain actions require a signed founder action, not the console.",
    };
  }
  // No backend configured (cold/prototype) — succeed without persistence so the
  // Console's optimistic item still stands.
  if (!supabase) return { ok: true, persisted: false };

  const kind = input.kind === "proposal" ? "proposal" : "directive";

  // Verified author: the signature proves ownership of authorWallet. Only then do
  // we attribute the directive — and only via service_role, since anon RLS forbids
  // a non-null author or verified=true (that's what blocks REST spoofing).
  const verified =
    !!input.proof &&
    !!input.authorWallet &&
    input.proof.pubkey === input.authorWallet &&
    verifyDirectiveProof(input.proof, input.projectKey, text);

  if (verified && supabaseAdmin) {
    const { error } = await supabaseAdmin.from("directives").insert({
      project_key: input.projectKey,
      kind,
      text,
      role: "holder",
      status: "open",
      author_wallet: input.proof!.pubkey.slice(0, 64),
      verified: true,
    });
    if (error) return { ok: false, persisted: false, error: error.message };
    return { ok: true, persisted: true };
  }

  // Unverified: anonymous, unattributed, unverified. RLS requires exactly this.
  const { error } = await supabase.from("directives").insert({
    project_key: input.projectKey,
    kind,
    text,
    role: "holder",
    status: "open",
    author_wallet: null,
    verified: false,
  });
  if (error) return { ok: false, persisted: false, error: error.message };
  return { ok: true, persisted: true };
}
