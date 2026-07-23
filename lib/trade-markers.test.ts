import { describe, expect, it, vi, afterEach } from "vitest";
import { tradeMarkers } from "@/components/token/Chart";
import type { Candle, Trade } from "./types";

const BUCKET = 900; // 15-minute candles
const NOW = 1_800_000_000; // fixed "now" in unix seconds

/** Six 15-min candles ending at the current bucket. */
const candles: Candle[] = Array.from({ length: 6 }, (_, i) => {
  const t = NOW - (5 - i) * BUCKET;
  return { t, o: 1, h: 1.2, l: 0.9, c: 1.1 };
});

function trade(ageSeconds: number, side: "BUY" | "SELL", sig?: string): Trade {
  return { addr: "a", side, sol: "1.00", tokens: "1", ageSeconds, sig };
}

afterEach(() => vi.useRealTimers());

function atNow() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
}

describe("tradeMarkers", () => {
  it("places a trade on the candle whose bucket contains it", () => {
    atNow();
    // 2 buckets back → index 3 of 6.
    expect(tradeMarkers(candles, [trade(2 * BUCKET, "BUY")])).toEqual([
      { i: 3, side: "BUY", sig: undefined },
    ]);
  });

  it("drops trades older than the charted window", () => {
    atNow();
    expect(tradeMarkers(candles, [trade(30 * BUCKET, "SELL")])).toEqual([]);
  });

  it("keeps one marker per candle per side", () => {
    atNow();
    // 1000s and 1200s ago both fall in the same 15-min bucket.
    const out = tradeMarkers(candles, [
      trade(1000, "BUY", "a"),
      trade(1200, "BUY", "b"), // same bucket, same side → collapsed
      trade(1200, "SELL", "c"), // same bucket, other side → kept
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.side).sort()).toEqual(["BUY", "SELL"]);
  });

  it("returns nothing without timestamps or trades", () => {
    atNow();
    const untimed: Candle[] = [{ o: 1, h: 1, l: 1, c: 1 }];
    expect(tradeMarkers(untimed, [trade(0, "BUY")])).toEqual([]);
    expect(tradeMarkers(candles, [])).toEqual([]);
  });
});
