// Pure, zero-import helper for the transparency budget view.
// Kept standalone (no imports) so it compiles and tests fast in isolation.

export type BudgetStatus = {
  spent: number;
  cap: number;
  remaining: number;
  /** Percent of cap spent, clamped to 0..100 and rounded to 1 decimal. */
  pct: number;
};

function safeNumber(n: number): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Compute a clamped budget status from a spent amount and a cap.
 * - Negative inputs are floored to 0.
 * - remaining never goes below 0.
 * - pct is 0 when cap <= 0, otherwise clamped to 0..100.
 */
export function budgetStatus(spentInput: number, capInput: number): BudgetStatus {
  const spent = Math.max(0, safeNumber(spentInput));
  const cap = Math.max(0, safeNumber(capInput));
  const remaining = Math.max(0, cap - spent);
  let pct = 0;
  if (cap > 0) {
    pct = (spent / cap) * 100;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    pct = Math.round(pct * 10) / 10;
  }
  return { spent, cap, remaining, pct };
}
