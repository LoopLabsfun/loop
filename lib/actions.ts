"use server";

import { supabase } from "./supabase";
import type { LaunchInput, LaunchResult } from "./api";

const TICKER_RE = /^[A-Z0-9]{2,10}$/;
const GITHUB_RE = /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+\/?$/i;

const NAME_MAX = 60;
const PROMPT_MAX = 2000;
const DESCRIPTION_MAX = 200;
const REPO_MAX = 200;

function slugify(ticker: string, name: string): string {
  const base = (ticker || name).toLowerCase().replace(/[^a-z0-9]/g, "");
  return base || "project";
}

/**
 * Sanitize + validate launch input. A server action is a public endpoint —
 * it can be called outside the UI — so we never trust the client. Throws a
 * user-facing Error on invalid input; otherwise returns clean fields.
 */
function sanitizeLaunch(input: LaunchInput) {
  const name = (input.name ?? "").trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
  const ticker = (input.ticker ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  const prompt = (input.prompt ?? "").trim().slice(0, PROMPT_MAX);
  let repo = (input.repo ?? "").trim().slice(0, REPO_MAX);
  // Only keep a plausible GitHub repo reference; drop anything else.
  if (repo && !GITHUB_RE.test(repo)) repo = "";

  if (!name) throw new Error("Project name is required.");
  if (!TICKER_RE.test(ticker)) {
    throw new Error("Ticker must be 2–10 letters or digits.");
  }
  return { name, ticker, prompt, repo };
}

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
