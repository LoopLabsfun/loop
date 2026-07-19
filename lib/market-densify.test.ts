import { describe, expect, it, vi } from "vitest";
import { densify } from "./market";

// rows: [ts, o, h, l, c, v?] (GeckoTerminal OHLCV order)
const HOUR = 3600;

describe("densify", () => {
  it("returns [] for no rows", () => {
    expect(densify([], HOUR, 60)).toEqual([]);
  });

  it("fills gaps between sparse candles with flat candles at previous close", () => {
    const t0 = Math.floor(Date.now() / 1000 / HOUR) * HOUR - 5 * HOUR;
    const rows = [
      [t0, 1, 2, 0.5, 1.5, 120],
      [t0 + 3 * HOUR, 1.6, 1.8, 1.4, 1.7, 45], // 2-bucket gap
    ];
    const out = densify(rows, HOUR, 60);
    // t0, +1h flat, +2h flat, +3h real, then flat to now (2 more)
    expect(out.length).toBe(6);
    expect(out[1]).toEqual({ t: t0 + HOUR, o: 1.5, h: 1.5, l: 1.5, c: 1.5, v: 0 });
    expect(out[2]).toEqual({ t: t0 + 2 * HOUR, o: 1.5, h: 1.5, l: 1.5, c: 1.5, v: 0 });
    expect(out[3]).toEqual({ t: t0 + 3 * HOUR, o: 1.6, h: 1.8, l: 1.4, c: 1.7, v: 45 });
    expect(out[5]).toEqual({ t: t0 + 5 * HOUR, o: 1.7, h: 1.7, l: 1.7, c: 1.7, v: 0 });
  });

  it("keeps the real bucket's volume and defaults missing volume to 0", () => {
    const t0 = Math.floor(Date.now() / 1000 / HOUR) * HOUR;
    expect(densify([[t0, 1, 1, 1, 1]], HOUR, 60)[0]!.v).toBe(0);
    expect(densify([[t0, 1, 1, 1, 1, 33]], HOUR, 60)[0]!.v).toBe(33);
  });

  it("caps output at limit, keeping the most recent buckets", () => {
    const t0 = Math.floor(Date.now() / 1000 / HOUR) * HOUR - 100 * HOUR;
    const rows = [[t0, 1, 1, 1, 1]];
    const out = densify(rows, HOUR, 60);
    expect(out.length).toBe(60);
    expect(out[59]).toMatchObject({ o: 1, h: 1, l: 1, c: 1, v: 0 });
  });

  it("survives pathological gaps without unbounded output", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-18T12:00:00Z"));
      const rows = [
        [0, 1, 1, 1, 1], // 1970 → now at 1h buckets would be ~495k candles
        [3600, 1, 1, 1, 1],
      ];
      const out = densify(rows, HOUR, 60);
      expect(out.length).toBeLessThanOrEqual(60);
    } finally {
      vi.useRealTimers();
    }
  });
});
