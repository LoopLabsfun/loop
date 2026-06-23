// ─────────────────────────────────────────────────────────────────────────────
// EXPENSE LEDGER — the real bills behind "an autonomous software company".
//
// `lib/economics.ts` *models* a project's burn by splitting a SOL/day snapshot.
// This module is the other half: the REAL, named bills the platform actually
// pays to keep LOOP's agent alive — a carnet de comptes the treasury has to
// cover. Each entry is a real line item (provider, what it buys, how often it
// recurs, what it costs), so the UI can show honest past spend AND projected
// forward burn / runway instead of a modeled guess.
//
// Pure + client-safe (no `server-only`, no network): the one live input — real
// Claude API spend — is fetched server-side (lib/anthropic-cost.ts) and overlaid
// via `withCompute`, so this stays unit-testable and rendable anywhere.
//
// Amounts are the genuine subscription/one-off prices (USD). They're env-
// overridable so a redeploy can correct a price without a code change, but the
// defaults are the real numbers as of the LOOP launch.
// ─────────────────────────────────────────────────────────────────────────────

export type LedgerCategory =
  | "compute" // LLM inference (Claude) — the brain
  | "hosting" // app + cron hosting
  | "sandbox" // the agent's build environment
  | "social" // posting / presence
  | "listing"; // market visibility / token info

/** How a cost repeats. `metered` = a live measured number (e.g. Claude usage). */
export type Cadence = "once" | "monthly" | "metered";

export interface LedgerEntry {
  id: string;
  label: string;
  provider: string;
  category: LedgerCategory;
  cadence: Cadence;
  /**
   * USD amount. monthly → per month; once → the one-off total; metered → spend
   * measured to date (filled live by `withCompute`, 0 until then).
   */
  usd: number;
  currency: "USD" | "USDC" | "SOL";
  /** ISO date the cost first started (recurring) or was paid (one-off). */
  since: string;
  note?: string;
}

export interface LedgerSummary {
  entries: LedgerEntry[];
  /** ISO genesis the ledger is reckoned from (first dollar spent). */
  sinceISO: string;
  /** Whole + partial months elapsed since genesis (≥ 0). */
  monthsElapsed: number;
  /** Total actually spent to date: one-offs + recurring×months + metered. */
  spentToDateUsd: number;
  /** Sum of every `monthly` line — the fixed recurring burn. */
  monthlyRecurringUsd: number;
  /** Live metered spend to date (Claude), 0 until `withCompute` overlays it. */
  meteredToDateUsd: number;
  /**
   * Projected forward monthly burn: fixed recurring + the metered run-rate
   * (metered-to-date ÷ months elapsed). The honest "what next month costs".
   */
  projectedMonthlyUsd: number;
}

function envUsd(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// LOOP's first dollar of infra spend lines up with the token genesis (2026-06-16,
// the projects row's created_at) — same anchor the Claude Cost API uses.
export const LEDGER_GENESIS = "2026-06-16T00:00:00Z";

/**
 * The real, named bills for LOOP. Compute is a placeholder (metered, filled live
 * from the Admin Cost API); the rest are genuine subscription / one-off prices.
 * Env-overridable so a price change needs no code edit.
 */
export function loopLedger(): LedgerEntry[] {
  return [
    {
      id: "claude",
      label: "Claude — Agent SDK",
      provider: "Anthropic",
      category: "compute",
      cadence: "metered",
      usd: 0, // overlaid live by withCompute()
      currency: "USD",
      since: LEDGER_GENESIS,
      note: "Metered per agent cycle — the brain. Real spend via the Admin Cost API.",
    },
    {
      id: "vercel",
      label: "Vercel Pro — hosting + cron",
      provider: "Vercel",
      category: "hosting",
      cadence: "monthly",
      usd: envUsd("LEDGER_VERCEL_USD", 20),
      currency: "USD",
      since: LEDGER_GENESIS,
      note: "App hosting, force-dynamic renders, and the */2 agent heartbeat cron.",
    },
    {
      id: "e2b",
      label: "E2B — agent sandbox",
      provider: "E2B",
      category: "sandbox",
      cadence: "monthly",
      usd: envUsd("LEDGER_E2B_USD", 5),
      currency: "USD",
      since: LEDGER_GENESIS,
      note: "The warm build environment the agent runs the CI gate + commits in.",
    },
    {
      id: "x-premium",
      label: "X Premium — agent voice",
      provider: "X (Twitter)",
      category: "social",
      cadence: "monthly",
      usd: envUsd("LEDGER_X_USD", 5),
      currency: "USD",
      since: LEDGER_GENESIS,
      note: "Build-in-public posting from @looplabsfun.",
    },
    {
      id: "dexscreener",
      label: "DEX Screener — Enhanced Token Info",
      provider: "DEX Screener",
      category: "listing",
      cadence: "once",
      usd: envUsd("LEDGER_DEXSCREENER_USD", 299),
      currency: "USDC",
      since: LEDGER_GENESIS,
      note: "One-off paid token profile: logo, links, socials on the $LOOP pair.",
    },
  ];
}

/** Whole+fractional months between an ISO date and now (≥ 0). 30.44-day month. */
export function monthsBetween(sinceISO: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(sinceISO).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / (1000 * 60 * 60 * 24 * 30.44);
}

/**
 * Overlay the live metered Claude spend onto the ledger's `metered` line(s).
 * `spentUsd` is the real total-to-date from the Admin Cost API. Returns a new
 * array (no mutation); a null/undefined spend leaves the placeholder at 0.
 */
export function withCompute(
  entries: LedgerEntry[],
  spentUsd: number | null | undefined
): LedgerEntry[] {
  if (spentUsd == null || !Number.isFinite(spentUsd)) return entries;
  return entries.map((e) =>
    e.cadence === "metered" ? { ...e, usd: Math.max(0, spentUsd) } : e
  );
}

/** Roll the ledger up into the numbers the cost card renders. Pure. */
export function ledgerSummary(
  entries: LedgerEntry[],
  opts?: { sinceISO?: string; now?: Date }
): LedgerSummary {
  const sinceISO = opts?.sinceISO ?? LEDGER_GENESIS;
  const months = monthsBetween(sinceISO, opts?.now);

  let oneOff = 0;
  let monthly = 0;
  let metered = 0;
  for (const e of entries) {
    if (e.cadence === "once") oneOff += e.usd;
    else if (e.cadence === "monthly") monthly += e.usd;
    else metered += e.usd;
  }

  const spentToDate = oneOff + monthly * months + metered;
  // Metered run-rate: spread the measured spend over the elapsed window. Guard
  // the first hours (months≈0) so we don't divide into a huge bogus rate.
  const meteredRunRate = months > 0.05 ? metered / months : 0;

  return {
    entries,
    sinceISO,
    monthsElapsed: months,
    spentToDateUsd: Math.round(spentToDate * 100) / 100,
    monthlyRecurringUsd: Math.round(monthly * 100) / 100,
    meteredToDateUsd: Math.round(metered * 100) / 100,
    projectedMonthlyUsd: Math.round((monthly + meteredRunRate) * 100) / 100,
  };
}

/**
 * Runway in months: how long the treasury covers the projected monthly burn.
 * Infinity when there's no burn; 0 when burning with an empty treasury.
 */
export function runwayMonths(treasuryUsd: number, projectedMonthlyUsd: number): number {
  if (projectedMonthlyUsd <= 0) return Infinity;
  return Math.max(0, treasuryUsd) / projectedMonthlyUsd;
}
