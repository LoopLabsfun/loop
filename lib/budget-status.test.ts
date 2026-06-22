import { describe, it, expect } from "vitest";
import { budgetStatus } from "./budget-status";

describe("budgetStatus", () => {
  it("computes remaining and pct for a normal spend", () => {
    expect(budgetStatus(2, 10)).toEqual({ spent: 2, cap: 10, remaining: 8, pct: 20 });
  });

  it("clamps pct to 100 and remaining to 0 when over cap", () => {
    expect(budgetStatus(15, 10)).toEqual({ spent: 15, cap: 10, remaining: 0, pct: 100 });
  });

  it("returns 0 pct when cap is zero or negative", () => {
    expect(budgetStatus(5, 0)).toEqual({ spent: 5, cap: 0, remaining: 0, pct: 0 });
    expect(budgetStatus(5, -3)).toEqual({ spent: 5, cap: 0, remaining: 0, pct: 0 });
  });

  it("floors negative spend to 0", () => {
    expect(budgetStatus(-4, 10)).toEqual({ spent: 0, cap: 10, remaining: 10, pct: 0 });
  });

  it("rounds pct to one decimal place", () => {
    expect(budgetStatus(1, 3).pct).toBe(33.3);
  });

  it("treats non-finite inputs as 0", () => {
    expect(budgetStatus(NaN, Infinity)).toEqual({ spent: 0, cap: 0, remaining: 0, pct: 0 });
  });
});
