// Pure, dependency-free helper computing how much SOL the agent has actually
// SPENT within a rolling window. Pairs with budgetStatusFromPolicy(): that
// helper supplies the cap, this one supplies the matching `spent` figure so the
// transparency budget view and the guardrail agree on both numbers.
//
// Standalone sibling module (like budget-status.ts) because lib/budget.ts is
// gate-protected.

/** Minimal shape of a wallet action this helper needs to score a spend. */
export interface SpendEntry {
  /** SOL committed by the action. */
  amountSol: number;
  /** Outcome of the action — only 'executed' actually moved SOL. */
  disposition: string;
  /** ISO timestamp of when the action happened. */
  at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function safeAmount(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * Sum the SOL actually spent within the last `windowMs` (default 24h) up to
 * `now`. Only `executed` actions count — `simulated`, `escalated`, and `denied`
 * actions committed no real SOL, so including them would overstate the spend.
 *
 * Guarantees:
 * - negative / NaN amounts contribute 0
 * - entries with an unparseable or out-of-window timestamp are ignored
 * - the result is always >= 0
 */
export function spentTodaySol(
  entries: readonly SpendEntry[],
  now: number = Date.now(),
  windowMs: number = DAY_MS
): number {
  // Guard the window bounds themselves: a NaN `now` (or a non-finite/negative
  // windowMs) makes `cutoff` NaN, and then every `t < cutoff` / `t > now`
  // comparison returns false — silently bypassing the window so EVERY executed
  // entry gets counted (the budget gate would then over-report spend). Fall back
  // to sane defaults so the time window always holds.
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const win = Number.isFinite(windowMs) && windowMs >= 0 ? windowMs : DAY_MS;
  const cutoff = nowMs - win;
  let total = 0;
  for (const e of entries) {
    if (e.disposition !== "executed") continue;
    const t = new Date(e.at).getTime();
    if (!Number.isFinite(t) || t < cutoff || t > nowMs) continue;
    total += safeAmount(e.amountSol);
  }
  return total;
}
