import { describe, it, expect } from "vitest";
import { extractVisitors } from "./vercel-analytics";

describe("extractVisitors", () => {
  it("reads the { visitors: { total } } overview shape", () => {
    expect(extractVisitors({ visitors: { total: 1234 } })).toBe(1234);
  });

  it("reads the { devices: { total } } shape", () => {
    expect(extractVisitors({ devices: { total: 88 } })).toBe(88);
  });

  it("reads a flat { visitors } number", () => {
    expect(extractVisitors({ visitors: 42 })).toBe(42);
  });

  it("coerces numeric strings", () => {
    expect(extractVisitors({ visitors: { total: "777" } })).toBe(777);
  });

  it("deep-searches for the largest visitors-keyed value", () => {
    const payload = {
      data: { series: [{ unique_visitors: 10 }, { unique_visitors: 30 }] },
    };
    expect(extractVisitors(payload)).toBe(30);
  });

  it("returns null when nothing visitor-like is present", () => {
    expect(extractVisitors({ pageviews: { total: 500 } })).toBeNull();
    expect(extractVisitors(null)).toBeNull();
    expect(extractVisitors("nope")).toBeNull();
  });
});
