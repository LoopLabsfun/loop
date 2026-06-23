import { describe, it, expect } from "vitest";
import { budgetStatusFromPolicy } from "./budget-status-policy";
import { DEFAULT_POLICY } from "./agent-actions";

describe("budgetStatusFromPolicy", () => {
  it("uses the policy's maxDailySol as the cap", () => {
    const s = budgetStatusFromPolicy(0.5);
    expect(s.cap).toBe(DEFAULT_POLICY.maxDailySol);
    expect(s.spent).toBe(0.5);
    expect(s.remaining).toBe(DEFAULT_POLICY.maxDailySol - 0.5);
    expect(s.pct).toBeCloseTo((0.5 / DEFAULT_POLICY.maxDailySol) * 100);
  });

  it("clamps spend above the cap", () => {
    const s = budgetStatusFromPolicy(99);
    expect(s.spent).toBe(DEFAULT_POLICY.maxDailySol);
    expect(s.remaining).toBe(0);
    expect(s.pct).toBe(100);
  });

  it("treats negative / NaN spend as zero", () => {
    expect(budgetStatusFromPolicy(-5).spent).toBe(0);
    expect(budgetStatusFromPolicy(NaN).pct).toBe(0);
    expect(budgetStatusFromPolicy(NaN).remaining).toBe(DEFAULT_POLICY.maxDailySol);
  });

  it("respects a custom policy cap", () => {
    const s = budgetStatusFromPolicy(1, { ...DEFAULT_POLICY, maxDailySol: 4 });
    expect(s.cap).toBe(4);
    expect(s.remaining).toBe(3);
    expect(s.pct).toBeCloseTo(25);
  });

  it("yields pct 0 when the policy cap is 0", () => {
    const s = budgetStatusFromPolicy(1, { ...DEFAULT_POLICY, maxDailySol: 0 });
    expect(s.cap).toBe(0);
    expect(s.pct).toBe(0);
    expect(s.remaining).toBe(0);
  });
});
