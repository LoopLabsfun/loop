"use server";

import { supabase } from "./supabase";
import type { LaunchInput, LaunchResult } from "./api";

function slugify(ticker: string, name: string): string {
  const base = (ticker || name).toLowerCase().replace(/[^a-z0-9]/g, "");
  return base || "project";
}

/**
 * Persist a newly launched project. Prototype implementation: inserts a row
 * with sensible defaults. Production would first verify the 1,000 LOOP stake
 * on-chain, create the mint + treasury wallet, then insert here.
 */
export async function launchProjectAction(
  input: LaunchInput
): Promise<LaunchResult> {
  const ticker =
    "$" +
    (input.ticker.trim() || "OSCUR").toUpperCase().replace(/^\$/, "");
  const wallet = "3mQz…r8Lk";
  let key = slugify(ticker.slice(1), input.name);

  if (!supabase) {
    return { key, wallet, ticker, staked: "1,000 LOOP" };
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
    name: input.name.trim() || "Untitled Project",
    ticker,
    description: input.prompt.trim().slice(0, 200),
    official: false,
    launchpad: "Pump.fun",
    repo: input.repo?.trim() ?? "",
    cover: "neon",
    prompt: input.prompt.trim(),
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

  return { key, wallet, ticker, staked: "1,000 LOOP" };
}
