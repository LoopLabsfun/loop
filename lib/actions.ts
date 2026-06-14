"use server";

import { supabase, supabaseAdmin } from "./supabase";
import type { LaunchInput, LaunchResult } from "./api";
import { sanitizeLaunch, slugify, DESCRIPTION_MAX } from "./launch";
import { createToken } from "./launchpad";

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

  // Mint the token (no-op in simulated mode). The UI network switch selects the
  // cluster; the server falls back to LAUNCH_CLUSTER when none is passed.
  const token = await createToken({
    name: clean.name,
    ticker: clean.ticker,
    prompt: clean.prompt,
    cluster: input.network,
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
  });

  return result;
}
