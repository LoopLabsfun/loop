import { describe, expect, it } from "vitest";
import { clampRange } from "@/components/token/TradingChart";

// The series the user is switching *into*: Jul 1 → Jul 10 (unix days).
const FIRST = 1_000_000;
const LAST = 2_000_000;

describe("clampRange", () => {
  it("keeps a window that sits inside the new series", () => {
    expect(clampRange(1_200_000, 1_500_000, FIRST, LAST)).toEqual({
      from: 1_200_000,
      to: 1_500_000,
    });
  });

  it("clamps a window that overhangs the new series", () => {
    // Zoomed to a span reaching before the new timeframe's history.
    expect(clampRange(500_000, 1_500_000, FIRST, LAST)).toEqual({
      from: FIRST,
      to: 1_500_000,
    });
  });

  it("fits content when the window covers everything (zoomed all the way out)", () => {
    expect(clampRange(0, 9_000_000, FIRST, LAST)).toBeNull();
  });

  it("fits content when the window misses the new series entirely", () => {
    expect(clampRange(10, 100, FIRST, LAST)).toBeNull();
    expect(clampRange(8_000_000, 9_000_000, FIRST, LAST)).toBeNull();
  });

  it("fits content on a degenerate window", () => {
    expect(clampRange(1_500_000, 1_500_000, FIRST, LAST)).toBeNull();
  });
});
