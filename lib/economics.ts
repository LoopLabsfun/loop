import type { Project } from "./types";
import { defaultMandate } from "./console";
import { SOL_USD } from "./format";

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT ECONOMICS — what the agent's "burn" actually pays for.
//
// Loop is "Polsia, but funded by fees": every project carries real infra costs —
// LLM compute, email, social, hosting — and the trading fees + creator rewards
// flowing into the treasury are meant to cover them. This module turns the
// opaque `burnPerDay` snapshot into an itemised infra bill so the UI (and, later,
// the runtime's metered spend) can show exactly where the money goes.
//
// Pure — no React, no network — so it's unit-testable and can be swapped for the
// runtime's real per-cycle metering without touching components. The model tier
// is the single biggest cost lever and is set by the on-chain stake tier
// (1,000 → Haiku, 5,000 → Sonnet, 25,000 → Opus); we reuse `defaultMandate` so
// the cost card and the Agent Console always agree on which model is running.
// ─────────────────────────────────────────────────────────────────────────────

export type ModelTier = "Haiku" | "Sonnet" | "Opus";

export type CostKey = "compute" | "email" | "social" | "hosting";

export interface CostItem {
  key: CostKey;
  label: string;
  detail: string;
  /** Share of the daily infra budget, 0..1. */
  share: number;
  solPerDay: number;
  usdPerMonth: number;
}

export interface InfraBreakdown {
  tier: ModelTier;
  /** Daily infra budget in SOL (the parsed burn rate). */
  solPerDay: number;
  usdPerMonth: number;
  items: CostItem[];
  /**
   * X/Twitter posting is a paid (~$200/mo Basic) founder-connected OAuth opt-in,
   * NOT a default — X forbids programmatic account creation (see
   * docs/agent-runtime.md §5). Off unless the founder connects it.
   */
  xEnabled: boolean;
}

// How the daily infra budget splits across line items, per model tier. Compute
// dominates more at higher tiers (a bigger brain is the expensive part); the
// fixed costs (hosting, email, social) take a smaller slice as the budget grows.
// Each row sums to 1.0.
const SHARES: Record<ModelTier, Record<CostKey, number>> = {
  Haiku: { compute: 0.55, email: 0.12, social: 0.08, hosting: 0.25 },
  Sonnet: { compute: 0.66, email: 0.09, social: 0.06, hosting: 0.19 },
  Opus: { compute: 0.76, email: 0.06, social: 0.04, hosting: 0.14 },
};

// Stable display order (matches how the costs are introduced to founders:
// compute + email + social + hosting).
const ORDER: CostKey[] = ["compute", "email", "social", "hosting"];

const LABEL: Record<CostKey, string> = {
  compute: "Compute",
  email: "Email",
  social: "Social",
  hosting: "Hosting",
};

function detailFor(key: CostKey, tier: ModelTier, xEnabled: boolean): string {
  switch (key) {
    case "compute":
      return `${tier} via Claude Agent SDK · metered per cycle`;
    case "email":
      return "Agent mailbox · Cloudflare routing + sending";
    case "social":
      return xEnabled
        ? "Farcaster + Telegram (free) + X (paid)"
        : "Farcaster + Telegram (free APIs)";
    case "hosting":
      return "Vercel deploy · E2B sandbox · Trigger.dev cron";
  }
}

/** Parse a "0.42 SOL/day" snapshot (or a raw number) into SOL/day. */
export function parseSolPerDay(
  burn: string | number | null | undefined
): number {
  if (typeof burn === "number") return burn >= 0 ? burn : 0;
  if (!burn) return 0;
  const m = String(burn).match(/[\d.]+/);
  const n = m ? parseFloat(m[0]) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Which model the agent runs — the single biggest cost lever (stake tier). */
export function modelTier(p: Project): ModelTier {
  return defaultMandate(p).model;
}

/**
 * Itemise a project's daily burn into the real infra bill it stands for. The
 * line items always sum back to the burn, so this *explains* the existing number
 * rather than inventing a new one.
 */
export function infraBreakdown(
  p: Project,
  solUsd: number = SOL_USD,
  opts?: { xEnabled?: boolean }
): InfraBreakdown {
  const tier = modelTier(p);
  const solPerDay = parseSolPerDay(p.burnPerDay);
  const xEnabled = opts?.xEnabled ?? false;
  const shares = SHARES[tier];

  const items: CostItem[] = ORDER.map((key) => {
    const share = shares[key];
    const itemSol = solPerDay * share;
    return {
      key,
      label: LABEL[key],
      detail: detailFor(key, tier, xEnabled),
      share,
      solPerDay: itemSol,
      usdPerMonth: itemSol * 30 * solUsd,
    };
  });

  return {
    tier,
    solPerDay,
    usdPerMonth: solPerDay * 30 * solUsd,
    items,
    xEnabled,
  };
}

/**
 * Fee coverage: how many times the daily fee/reward income covers the infra
 * burn. > 1 means the project pays its own bills with room to spare; the runway
 * (treasury ÷ burn) is the buffer for when it dips below. Pure helper for the
 * "funded by fees" signal.
 */
export function feeCoverage(
  dailyIncomeSol: number,
  solPerDay: number
): number {
  if (solPerDay <= 0) return Infinity;
  return Math.max(0, dailyIncomeSol) / solPerDay;
}
