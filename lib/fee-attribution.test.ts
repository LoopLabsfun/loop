import { describe, it, expect } from "vitest";
import { attributeClaim, volumeWeight } from "./fee-attribution";

describe("attributeClaim", () => {
  it("splits proportional to weight and re-sums exactly", () => {
    const out = attributeClaim(1, [
      { key: "a", weight: 3 },
      { key: "b", weight: 1 },
    ]);
    expect(out).toEqual([
      { key: "a", sol: 0.75 },
      { key: "b", sol: 0.25 },
    ]);
    expect(out.reduce((s, x) => s + x.sol, 0)).toBeCloseTo(1, 9);
  });

  it("falls back to an equal split when all weights are 0", () => {
    const out = attributeClaim(0.9, [
      { key: "a", weight: 0 },
      { key: "b", weight: 0 },
      { key: "c", weight: 0 },
    ]);
    expect(out.map((o) => o.sol)).toEqual([0.3, 0.3, 0.3]);
  });

  it("always re-sums to the input lump (rounding drift on the first)", () => {
    const out = attributeClaim(1, [
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
      { key: "c", weight: 1 },
    ]);
    expect(out.reduce((s, x) => s + x.sol, 0)).toBeCloseTo(1, 9);
  });

  it("ignores negative / non-finite weights", () => {
    const out = attributeClaim(1, [
      { key: "a", weight: -5 },
      { key: "b", weight: 2 },
    ]);
    expect(out).toEqual([
      { key: "a", sol: 0 },
      { key: "b", sol: 1 },
    ]);
  });

  it("returns zeros for a non-positive claim", () => {
    expect(attributeClaim(0, [{ key: "a", weight: 1 }])).toEqual([
      { key: "a", sol: 0 },
    ]);
  });

  it("returns [] for an empty group", () => {
    expect(attributeClaim(1, [])).toEqual([]);
  });
});

describe("volumeWeight", () => {
  it("parses SOL-denominated volume", () => {
    expect(volumeWeight("12.5 SOL")).toBe(12.5);
    expect(volumeWeight("0 SOL")).toBe(0);
  });
  it("rejects fiat / placeholder / empty", () => {
    expect(volumeWeight("$30K")).toBe(0);
    expect(volumeWeight("—")).toBe(0);
    expect(volumeWeight(null)).toBe(0);
    expect(volumeWeight(undefined)).toBe(0);
  });
});
