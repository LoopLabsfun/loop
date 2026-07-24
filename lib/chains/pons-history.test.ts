import { describe, expect, it } from "vitest";
import {
  priceSwap,
  swapsToCandles,
  swapsToTrades,
  interpolateTs,
  type PricedSwap,
} from "./pons-history";

const wei = (n: number) => BigInt(Math.round(n * 1e18));

describe("priceSwap", () => {
  it("prices a swap as ethOut/tokenOut × ETH/USD", () => {
    // 0.5 ETH for 1000 tokens → 0.0005 ETH/token → $1.50 at $3000/ETH.
    const p = priceSwap(
      { ethWei: wei(0.5), tokenWei: wei(1000), isBuy: true, trader: "0xabc", txHash: "0xdead" },
      1000,
      3000,
    );
    expect(p).not.toBeNull();
    expect(p!.priceUsd).toBeCloseTo(1.5, 9);
    expect(p!.volumeUsd).toBeCloseTo(1500, 6); // 0.5 ETH × $3000
    expect(p!.eth).toBeCloseTo(0.5, 12);
    expect(p!.tokens).toBeCloseTo(1000, 6);
    expect(p!.isBuy).toBe(true);
  });

  it("drops a swap that moved no tokens", () => {
    expect(priceSwap({ ethWei: wei(1), tokenWei: BigInt(0), isBuy: true, trader: null, txHash: null }, 1, 3000)).toBeNull();
  });
});

/** Build a priced swap at a given time + price for the bucketing tests. */
function s(tsSec: number, priceUsd: number, volumeUsd = 1, isBuy = true): PricedSwap {
  return { tsSec, priceUsd, volumeUsd, eth: 0.01, tokens: 100, isBuy, trader: "0xabc0000000000000000000000000000000000000", txHash: "0x" + tsSec };
}

describe("swapsToCandles", () => {
  // densify extends flat to the current bucket and keeps the last `limit`, so
  // anchor the swaps just before "now" and read them out by bucket time.
  const B = 900;
  const base = Math.floor(Date.now() / 1000 / B) * B - 5 * B;

  it("groups swaps into OHLCV buckets", () => {
    const candles = swapsToCandles(
      [s(base + 10, 2), s(base + 800, 5), s(base + B + 100, 3)],
      B,
      50,
    );
    const byT = new Map(candles.map((c) => [c.t, c]));
    expect(byT.get(base)).toMatchObject({ o: 2, h: 5, l: 2, c: 5, v: 2 });
    expect(byT.get(base + B)).toMatchObject({ o: 3, h: 3, l: 3, c: 3, v: 1 });
  });

  it("gap-fills a quiet stretch at the previous close", () => {
    const candles = swapsToCandles([s(base + 10, 2), s(base + 2 * B + 10, 4)], B, 50);
    const byT = new Map(candles.map((c) => [c.t, c]));
    expect(byT.get(base)).toMatchObject({ c: 2 });
    expect(byT.get(base + B)).toMatchObject({ o: 2, h: 2, l: 2, c: 2, v: 0 });
    expect(byT.get(base + 2 * B)).toMatchObject({ c: 4 });
  });

  it("returns nothing for no swaps", () => {
    expect(swapsToCandles([], 900, 10)).toEqual([]);
  });
});

describe("swapsToTrades", () => {
  it("returns newest-first with age from now", () => {
    const now = 10_000;
    const trades = swapsToTrades([s(1000, 2, 1, true), s(2000, 3, 1, false)], now, 10);
    expect(trades).toHaveLength(2);
    // newest (ts 2000) first
    expect(trades[0]).toMatchObject({ side: "SELL", ageSeconds: 8000 });
    expect(trades[1]).toMatchObject({ side: "BUY", ageSeconds: 9000 });
    expect(trades[0].addr).toBe("0xabc0…0000");
  });

  it("caps at n", () => {
    const swaps = Array.from({ length: 20 }, (_, i) => s(i * 100, 1));
    expect(swapsToTrades(swaps, 99_999, 10)).toHaveLength(10);
  });
});

describe("interpolateTs", () => {
  const a = { block: 100, ts: 1000 };
  const b = { block: 200, ts: 1010 }; // 0.1s/block

  it("interpolates linearly between anchors", () => {
    expect(interpolateTs(150, a, b)).toBe(1005);
    expect(interpolateTs(100, a, b)).toBe(1000);
    expect(interpolateTs(200, a, b)).toBe(1010);
  });

  it("handles a single-block window", () => {
    expect(interpolateTs(100, a, a)).toBe(1000);
  });
});
