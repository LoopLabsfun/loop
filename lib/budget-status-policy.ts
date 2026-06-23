import { budgetStatus, type BudgetStatus } from "./budget-status";
import { DEFAULT_POLICY, type ActionPolicy } from "./agent-actions";

// Policy-aware budget-status bridge for the transparency budget view.
//
// budgetStatus(spent, cap) is dependency-free and doesn't know where the daily
// cap comes from. The agent's rolling-24h SOL cap is defined by the action
// policy (ActionPolicy.maxDailySol) — the same number evaluateAction() enforces.
// This helper wires the two together so the budget view and the guardrail agree
// on the cap instead of hard-coding it twice.

/**
 * Derive today's clamped budget status from how much SOL the agent has
 * committed today, using the action policy's `maxDailySol` as the cap.
 *
 * Inherits budgetStatus()'s guarantees: spent floored at 0 and capped at the
 * daily cap, remaining never negative, pct in [0, 100].
 */
export function budgetStatusFromPolicy(
  spentTodaySol: number,
  policy: ActionPolicy = DEFAULT_POLICY
): BudgetStatus {
  return budgetStatus(spentTodaySol, policy.maxDailySol);
}
