import { describe, it, expect } from "vitest";
import { walletRunway, fmtRunwayDays } from "./wallet-runway";

describe("walletRunway", () => {
  it("computes balance / rate", () => {
    expect(walletRunway(1, 0.1)).toBeCloseTo(10, 10);
    expect(walletRunway(2, 0.4)).toBeCloseTo(5, 10);
  });

  it("returns null for zero or negative balance", () => {
    expect(walletRunway(0, 0.1)).toBeNull();
    expect(walletRunway(-1, 0.1)).toBeNull();
  });

  it("returns null for zero or negative rate", () => {
    expect(walletRunway(1, 0)).toBeNull();
    expect(walletRunway(1, -0.1)).toBeNull();
  });

  it("returns null for non-finite inputs", () => {
    expect(walletRunway(NaN, 0.1)).toBeNull();
    expect(walletRunway(1, NaN)).toBeNull();
    expect(walletRunway(Infinity, 0.1)).toBeNull();
    expect(walletRunway(1, Infinity)).toBeNull();
  });

  it("result is always a positive finite number when non-null", () => {
    const r = walletRunway(0.5, 0.05);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!)).toBe(true);
    expect(r!).toBeGreaterThan(0);
  });
});

describe("fmtRunwayDays", () => {
  it("returns '< 1 day' for fractional days", () => {
    expect(fmtRunwayDays(0.8)).toBe("< 1 day");
    expect(fmtRunwayDays(0)).toBe("< 1 day");
  });

  it("returns '< 1 day' for non-finite input", () => {
    expect(fmtRunwayDays(NaN)).toBe("< 1 day");
    expect(fmtRunwayDays(Infinity)).toBe("< 1 day");
  });

  it("uses singular 'day' for exactly 1", () => {
    expect(fmtRunwayDays(1)).toBe("~1 day");
    expect(fmtRunwayDays(1.4)).toBe("~1 day");
  });

  it("uses plural 'days' for > 1", () => {
    expect(fmtRunwayDays(2)).toBe("~2 days");
    expect(fmtRunwayDays(7.4)).toBe("~7 days");
    expect(fmtRunwayDays(30)).toBe("~30 days");
    expect(fmtRunwayDays(365)).toBe("~365 days");
  });

  it("rounds to nearest integer", () => {
    expect(fmtRunwayDays(6.6)).toBe("~7 days");
    expect(fmtRunwayDays(6.4)).toBe("~6 days");
  });
});
