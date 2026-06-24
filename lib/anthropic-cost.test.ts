import { describe, it, expect } from "vitest";
import { sumCostUsd, tokensToUsd } from "./anthropic-cost";

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

describe("tokensToUsd", () => {
  it("prices Opus 4.8 input + output at the table rate", () => {
    // 1M input @ $5 + 1M output @ $25 = $30.
    const usd = tokensToUsd(
      { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      "claude-opus-4-8"
    );
    expect(usd).toBeCloseTo(30, 6);
  });

  it("prices cache write at 1.25x input and cache read at 0.1x input", () => {
    // Opus: 1M cache-write @ $6.25 + 1M cache-read @ $0.50 = $6.75.
    const usd = tokensToUsd(
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      },
      "claude-opus-4-8"
    );
    expect(usd).toBeCloseTo(6.75, 6);
  });

  it("uses Haiku rates for the chat model", () => {
    // Haiku: 1M input @ $1 + 1M output @ $5 = $6.
    const usd = tokensToUsd(
      { input_tokens: 1_000_000, output_tokens: 1_000_000 },
      "claude-haiku-4-5-20251001"
    );
    expect(usd).toBeCloseTo(6, 6);
  });

  it("falls back to Opus pricing for an unknown model and handles null usage", () => {
    expect(tokensToUsd({ input_tokens: 1_000_000, output_tokens: 0 }, "mystery")).toBeCloseTo(5, 6);
    expect(tokensToUsd(null, "claude-opus-4-8")).toBe(0);
  });
});
