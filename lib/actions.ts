"use server";

import { supabase } from "./supabase";
import type { LaunchInput, LaunchResult } from "./api";
import { sanitizeLaunch, slugify, DESCRIPTION_MAX } from "./launch";

/**
 * Persist a newly launched project. Prototype implementation: inserts a row
 * with sensible (non-spoofable) defaults. Production would first verify the
 * 1,000 LOOP stake on-chain, create the mint + treasury wallet, then insert.
 */
export async function launchProjectAction(
  input: LaunchInput
): Promise<LaunchResult> {
  const clean = sanitizeLaunch(input);
  const ticker = "$" + clean.ticker;
  let key = slugify(clean.ticker, clean.name);

  if (!supabase) {
    return { key, ticker, staked: "1,000 LOOP" };
  }

  // Avoid colliding with an existing key.
  const { data: existing } = await supabase
    .from("projects")
    .select("key")
    .eq("key", key)
    .maybeSingle();
  if (existing) key = `${key}-${Date.now().toString(36).slice(-4)}`;

  await supabase.from("projects").insert({
    key,
    name: clean.name,
    ticker,
    description: clean.prompt.slice(0, DESCRIPTION_MAX),
    official: false,
    launchpad: "Pump.fun",
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
  });

  return { key, ticker, staked: "1,000 LOOP" };
}
