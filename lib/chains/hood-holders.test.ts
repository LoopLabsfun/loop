import { describe, expect, it } from "vitest";
import { mapHolders } from "./hood-holders";

const TOTAL = "1000000000000000000000000000"; // 1e27 (1B × 18dp)
const row = (hash: string, value: string, is_contract = false) => ({
  address: { hash, is_contract },
  value,
});

describe("mapHolders", () => {
  it("computes share = value / total supply", () => {
    const out = mapHolders([row("0xaaa", "174358000000000000000000000")], TOTAL, 10);
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe("0xaaa");
    expect(out[0].share).toBeCloseTo(0.174358, 6);
    expect(out[0].pool).toBeUndefined();
  });

  it("flags contract-owned balances as pools", () => {
    const out = mapHolders([row("0xpool", "500000000000000000000000000", true)], TOTAL, 10);
    expect(out[0]).toMatchObject({ pool: true, poolLabel: "pool / contract", share: 0.5 });
  });

  it("caps at n (top-n of the ranked list, no backfill)", () => {
    const items = [1, 2, 3, 4].map((i) => row(`0x${i}`, "100000000000000000000000000"));
    expect(mapHolders(items, TOTAL, 2).map((h) => h.address)).toEqual(["0x1", "0x2"]);
  });

  it("drops zero-balance, malformed, and address-less rows", () => {
    const items = [
      row("0x1", "100000000000000000000000000"),
      row("0x2", "0"), // zero balance
      row("0x3", "abc"), // malformed value
      row("", "100000000000000000000000000"), // no address
    ];
    expect(mapHolders(items, TOTAL, 10).map((h) => h.address)).toEqual(["0x1"]);
  });

  it("returns nothing without a usable supply", () => {
    expect(mapHolders([row("0x1", "1")], "0", 10)).toEqual([]);
    expect(mapHolders([row("0x1", "1")], "not-a-number", 10)).toEqual([]);
    expect(mapHolders([], TOTAL, 10)).toEqual([]);
  });

  it("keeps sub-1% precision on a huge-supply token", () => {
    // 0.05% of 1e27 = 5e23
    const out = mapHolders([row("0xsmall", "500000000000000000000000")], TOTAL, 10);
    expect(out[0].share).toBeCloseTo(0.0005, 6);
  });
});
