import { describe, it, expect } from "vitest";
import { sumCostUsd } from "./anthropic-cost";

describe("sumCostUsd", () => {
  it("sums cent-string amounts across buckets and results into USD", () => {
    const buckets = [
      { results: [{ amount: "123.45", currency: "USD" }, { amount: "76.55", currency: "USD" }] },
      { results: [{ amount: "100", currency: "USD" }] },
    ];
    // (123.45 + 76.55 + 100) cents = 300 cents = $3.00
    expect(sumCostUsd(buckets)).toBe(3);
  });

  it("treats missing/garbage amounts as zero", () => {
    const buckets = [
      { results: [{ amount: "250" }, { amount: undefined }, { amount: "oops" }] },
      { results: [] },
      {},
    ];
    expect(sumCostUsd(buckets)).toBe(2.5);
  });

  it("returns 0 for an empty report", () => {
    expect(sumCostUsd([])).toBe(0);
  });

  it("rounds sub-cent token-cost strings to the nearest cent", () => {
    // Cost API returns high-precision strings like "123.78912" (cents).
    const buckets = [{ results: [{ amount: "123.78912" }, { amount: "1.21088" }] }];
    // 125.0 cents → $1.25
    expect(sumCostUsd(buckets)).toBe(1.25);
  });
});
