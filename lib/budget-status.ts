// Pure, dependency-free budget-status helper for the transparency budget view.
// Kept as a standalone sibling module because lib/budget.ts is gate-protected.

export interface BudgetStatus {
  /** SOL spent so far, clamped to [0, cap]. */
  spent: number;
  /** Daily budget cap in SOL, clamped to >= 0. */
  cap: number;
  /** Remaining budget in SOL, always >= 0. */
  remaining: number;
  /** Percent of cap used, an integer-friendly number in [0, 100]. */
  pct: number;
  /**
   * True when the raw (unclamped) spend actually exceeded the cap. Because
   * `spent` is clamped to the cap, pct=100 alone can't tell "exactly at cap"
   * from a genuine over-spend — this flag lets the view flag the latter.
   */
  over: boolean;
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * Compute a clamped budget status from raw spent/cap inputs.
 *
 * Guarantees:
 * - spent and cap are floored at 0 (negatives / NaN -> 0)
 * - spent never exceeds cap
 * - remaining is never negative
 * - pct is in [0, 100]; a cap of 0 yields pct 0
 * - over is true iff the floored spend exceeds the cap (the clamp hides this)
 */
export function budgetStatus(spentInput: number, capInput: number): BudgetStatus {
  const cap = clampNonNegative(capInput);
  const flooredSpent = clampNonNegative(spentInput);
  const spent = Math.min(flooredSpent, cap);
  const remaining = Math.max(cap - spent, 0);
  const pct = cap === 0 ? 0 : Math.min(100, Math.max(0, (spent / cap) * 100));
  const over = flooredSpent > cap;
  return { spent, cap, remaining, pct, over };
}
