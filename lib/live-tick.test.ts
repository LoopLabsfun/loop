import { describe, expect, it } from "vitest";
import { withLiveTick } from "./useLiveMarket";
import type { Candle } from "./types";

const series: Candle[] = [
  { t: 1, o: 1, h: 1.2, l: 0.9, c: 1.1 },
  { t: 2, o: 1.1, h: 1.3, l: 1.0, c: 1.2 },
];

describe("withLiveTick", () => {
  it("moves the forming candle's close to the live price", () => {
    const out = withLiveTick(series, 1.25);
    expect(out[out.length - 1]).toMatchObject({ c: 1.25, h: 1.3, l: 1.0 });
    // earlier candles are untouched
    expect(out[0]).toBe(series[0]);
  });

  it("stretches high/low to contain a new extreme", () => {
    expect(withLiveTick(series, 1.4)[1]).toMatchObject({ c: 1.4, h: 1.4 });
    expect(withLiveTick(series, 0.99)[1]).toMatchObject({ c: 0.99, l: 0.99 });
  });

  it("ignores a price that disagrees with the candle feed", () => {
    // >20% drift means the two sources disagree, not that the market moved.
    expect(withLiveTick(series, 5)).toBe(series);
    expect(withLiveTick(series, 0.1)).toBe(series);
  });

  it("is a no-op without a usable price or series", () => {
    expect(withLiveTick(series, null)).toBe(series);
    expect(withLiveTick(series, 0)).toBe(series);
    expect(withLiveTick(series, 1.2)).toBe(series); // unchanged price
    expect(withLiveTick([], 1)).toEqual([]);
  });
});
