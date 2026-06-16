"use server";

import { supabase, supabaseAdmin } from "./supabase";
import type { LaunchInput, LaunchResult } from "./api";
import { sanitizeLaunch, slugify, DESCRIPTION_MAX } from "./launch";
import { createToken, parseCluster } from "./launchpad";
import { verifyLaunchProof } from "./signature";
import { hasRequiredStake, stakeEnforced, STAKE_REQUIRED_LOOP } from "./stake";
import { sanitizeDirectiveText } from "./directives";

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
 * Still TODO for real launch: verify/lock the 1,000 LOOP stake on-chain
 * (wallet-signature ownership proof) before minting.
 */
export async function launchProjectAction(
  input: LaunchInput
): Promise<LaunchResult> {
  const clean = sanitizeLaunch(input);
  const ticker = "$" + clean.ticker;
  let key = slugify(clean.ticker, clean.name);

  // Wallet ownership proof. If the client supplied a signature it MUST verify
  // (a forged/replayed one is rejected); the verified pubkey is recorded as the
  // creator. Absent proof is allowed in prototype mode — wallets that can't
  // signMessage still launch — and will become required alongside on-chain
  // stake verification.
  let creatorWallet: string | null = null;
  if (input.proof) {
    if (!verifyLaunchProof(input.proof, clean.ticker)) {
      throw new Error("Wallet signature could not be verified. Please retry.");
    }
    creatorWallet = input.proof.pubkey;
  }

  // The UI network switch selects the cluster; fall back to LAUNCH_CLUSTER.
  const cluster = input.network ?? parseCluster(process.env.LAUNCH_CLUSTER);

  // On-chain stake gate. When a LOOP mint is configured, the proven creator
  // wallet must hold the required LOOP before we mint/persist. Open (no-op) in
  // prototype mode where no LOOP_MINT is set.
  if (stakeEnforced()) {
    if (!creatorWallet) {
      throw new Error("Connect and verify your wallet to stake LOOP.");
    }
    if (!(await hasRequiredStake(creatorWallet, cluster))) {
      throw new Error(
        `You need at least ${STAKE_REQUIRED_LOOP.toLocaleString()} LOOP to launch a project.`
      );
    }
  }

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
    staked: "1,000 LOOP",
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
    repo: clean.repo,
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
}

export interface DirectiveResult {
  ok: boolean;
  /** False when persistence is unavailable (the UI keeps its optimistic item). */
  persisted: boolean;
  error?: string;
}

/**
 * Persist a steering directive submitted from the Agent Console. The insert is
 * locked to the hardened RLS invariants — every submission lands as an `open`,
 * `holder`-role row with zeroed tallies, so a direct REST call can't spoof an
 * already-applied founder directive. Promoting a directive to applied/adopted is
 * a runtime/service_role action.
 *
 * Still TODO (mirrors the launch flow): verify the author wallet (signature) and
 * gate holder directives on a project-token stake before accepting.
 */
export async function submitDirectiveAction(
  input: DirectiveInput
): Promise<DirectiveResult> {
  const text = sanitizeDirectiveText(input.text ?? "");
  if (!text) return { ok: false, persisted: false, error: "Directive is empty." };
  if (!input.projectKey) {
    return { ok: false, persisted: false, error: "Missing project." };
  }
  // No backend configured (cold/prototype) — succeed without persistence so the
  // Console's optimistic item still stands.
  if (!supabase) return { ok: true, persisted: false };

  const wallet = input.authorWallet?.slice(0, 64) || null;
  const { error } = await supabase.from("directives").insert({
    project_key: input.projectKey,
    kind: input.kind === "proposal" ? "proposal" : "directive",
    text,
    role: "holder",
    status: "open",
    author_wallet: wallet,
  });
  if (error) return { ok: false, persisted: false, error: error.message };
  return { ok: true, persisted: true };
}
