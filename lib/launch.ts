import type { LaunchInput } from "./api";

// Pure launch-input validation + slug logic, kept free of "use server" and the
// Supabase client so it can be unit-tested in isolation. `lib/actions.ts`
// (the server action) imports from here.

export const TICKER_RE = /^[A-Z0-9]{2,10}$/;
export const GITHUB_RE =
  /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+\/?$/i;

export const NAME_MAX = 60;
export const PROMPT_MAX = 2000;
export const DESCRIPTION_MAX = 200;
export const REPO_MAX = 200;

export interface CleanLaunch {
  name: string;
  ticker: string; // bare, uppercase, no leading "$"
  prompt: string;
  repo: string;
}

/** Derive a URL-safe project key from the ticker (fallback: name). */
export function slugify(ticker: string, name: string): string {
  const base = (ticker || name).toLowerCase().replace(/[^a-z0-9]/g, "");
  return base || "project";
}

/**
 * Sanitize + validate launch input. A server action is a public endpoint — it
 * can be called outside the UI — so we never trust the client. Throws a
 * user-facing Error on invalid input; otherwise returns clean, length-capped
 * fields that satisfy the projects RLS insert policy.
 */
export function sanitizeLaunch(input: LaunchInput): CleanLaunch {
  const name = (input.name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, NAME_MAX);
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
