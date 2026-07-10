import { SOL_USD } from "./format";

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE RAIL — how the agent pays for its own services out of its own fees.
//
// Loop is "an autonomous software company, funded by fees". The catch: providers (Anthropic for
// compute, plus email/hosting) bill in *fiat*, while a project earns *SOL*. The
// agent can't hand SOL to Anthropic. So Loop is the custodial payment rail:
//
//   agent-share SOL  →  (Jupiter swap)  USDC  →  Loop's provider account credit
//                    →  metered + debited per project via this compute-ledger.
//
// The agent never touches fiat; Loop tops up its provider account from converted
// SOL and meters each project's consumption against the credit it funded.
//
// THE SAFETY INVARIANT: a top-up may only draw from the **agent's own claimable
// share** (the 65% in fee-ledger's RoleTotals.agentSol) — never the founder or
// platform shares. `planTopUp` takes `availableAgentSol` as a hard cap, so the
// rail can never spend money that isn't the agent's to spend.
//
// Pure (no I/O), so the runtime's real swap + provider top-up plug straight in.
// `computeRailEnabled()` env-gates the *execution*: unset = no real conversion
// (prototype/simulation), the accounting still computes for the UI. The DB table
// (per-project credited + consumed USD) is the activation step, like fee-ledger.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default cut taken converting SOL → USDC → provider credit (DEX slippage +
 * on/off-ramp), in basis points. 1% = 100 bps. Conservative default.
 */
export const DEFAULT_SWAP_FEE_BPS = 100;

export interface ComputeLedger {
  /** USD of provider credit funded (post-fee) from converted agent-share SOL. */
  creditedUsd: number;
  /** USD of compute/infra metered as consumed. */
  consumedUsd: number;
}

export const ZERO_LEDGER: ComputeLedger = { creditedUsd: 0, consumedUsd: 0 };

// USD rounded to cents; SOL rounded to lamports (1 SOL = 1e9), matching fees.ts.
function usd(n: number): number {
  return Math.round(n * 100) / 100;
}
function sol9(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

/**
 * Remaining provider credit = funded − consumed. May go ≤ 0 (over-drawn) — the
 * runtime reads that as "top up from the agent share, or the agent sleeps".
 */
export function creditBalanceUsd(l: ComputeLedger): number {
  return usd(l.creditedUsd - l.consumedUsd);
}

/**
 * Low-water warning: true when the remaining credit has fallen to `frac` (or
 * less) of what was funded but ISN'T exhausted yet — the "warn the founder
 * BEFORE the budget gate puts the agent to sleep" threshold. False for an
 * unfunded ledger (nothing to warn about) and false at/below zero (the hard
 * gate has taken over; the raised warning stays open until a top-up).
 */
export function creditLowWater(l: ComputeLedger, frac = 0.2): boolean {
  const balance = creditBalanceUsd(l);
  return l.creditedUsd > 0 && balance > 0 && balance <= usd(l.creditedUsd * frac);
}

/** Record a top-up — post-fee USD credited to the provider account. */
export function recordTopUp(l: ComputeLedger, usdCredited: number): ComputeLedger {
  return { ...l, creditedUsd: usd(l.creditedUsd + Math.max(0, usdCredited)) };
}

/** Record metered compute/infra consumption (USD). */
export function recordSpend(l: ComputeLedger, usdSpent: number): ComputeLedger {
  return { ...l, consumedUsd: usd(l.consumedUsd + Math.max(0, usdSpent)) };
}

export interface Conversion {
  /** SOL converted in. */
  solIn: number;
  /** Gross USD before the swap/ramp fee. */
  usdGross: number;
  /** The swap + ramp cut, in USD. */
  feeUsd: number;
  /** Net provider credit, in USD (gross − fee). */
  usdCredited: number;
}

/** Pure: SOL → provider-credit USD, minus the swap/ramp fee. */
export function convertSolToCredits(
  solIn: number,
  solUsd: number = SOL_USD,
  feeBps: number = DEFAULT_SWAP_FEE_BPS
): Conversion {
  const sol = Math.max(0, solIn);
  const usdGross = usd(sol * Math.max(0, solUsd));
  const feeUsd = usd((usdGross * Math.max(0, feeBps)) / 10_000);
  return { solIn: sol9(sol), usdGross, feeUsd, usdCredited: usd(usdGross - feeUsd) };
}

export interface TopUpPlan {
  /** SOL to convert from the agent's claimable share (0 = no action). */
  solToConvert: number;
  /** USD credit the conversion yields (post-fee). */
  usdCredited: number;
  reason: string;
}

const NO_TOPUP = (reason: string): TopUpPlan => ({
  solToConvert: 0,
  usdCredited: 0,
  reason,
});

/**
 * Decide a top-up: bring the credit balance up toward `targetUsd` of runway,
 * funded ONLY from the agent's own claimable SOL — never founder/platform funds.
 * Converts just enough (grossed up for the swap fee so the *post-fee* credit hits
 * the target), hard-capped by what the agent actually has.
 */
export function planTopUp(args: {
  /** Current credit balance, USD (see creditBalanceUsd). */
  balanceUsd: number;
  /** Desired credit runway, USD. */
  targetUsd: number;
  /** The agent's claimable share, SOL — the only fundable source. */
  availableAgentSol: number;
  solUsd?: number;
  feeBps?: number;
}): TopUpPlan {
  const solUsd = args.solUsd ?? SOL_USD;
  const feeBps = args.feeBps ?? DEFAULT_SWAP_FEE_BPS;
  const avail = Math.max(0, args.availableAgentSol);
  const deficitUsd = usd(args.targetUsd - args.balanceUsd);

  if (deficitUsd <= 0) return NO_TOPUP("credit balance already at target");
  if (avail <= 0 || solUsd <= 0)
    return NO_TOPUP("no agent-share SOL available to convert");

  // Gross the deficit up by the fee so the post-fee credit lands on target.
  const feeFrac = Math.min(0.99, Math.max(0, feeBps) / 10_000);
  const grossUsdNeeded = deficitUsd / (1 - feeFrac);
  const solNeeded = grossUsdNeeded / solUsd;
  const solToConvert = sol9(Math.min(avail, solNeeded));
  const conv = convertSolToCredits(solToConvert, solUsd, feeBps);
  const capped = solToConvert < solNeeded;

  return {
    solToConvert,
    usdCredited: conv.usdCredited,
    reason: capped
      ? `partial top-up · agent share covers $${conv.usdCredited} of the $${deficitUsd} deficit`
      : `top-up $${conv.usdCredited} to reach $${args.targetUsd} credit runway`,
  };
}

/**
 * Env-gated: is a real compute provider wired for *execution*? Unset (prototype)
 * = the runtime does no real SOL→credit conversion; the accounting above still
 * computes for the UI. Lazy read so the module stays unit-testable.
 */
export function computeRailEnabled(): boolean {
  return !!process.env.COMPUTE_RAIL_PROVIDER;
}
