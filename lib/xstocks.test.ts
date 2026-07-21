import { describe, it, expect } from "vitest";
import { XSTOCKS, isXStockMint, xstockByMint, xstockBySymbol } from "./xstocks";

describe("xstocks registry", () => {
  it("every entry is a well-formed base58 Solana mint with 8 decimals", () => {
    const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    for (const s of XSTOCKS) {
      expect(BASE58.test(s.mint)).toBe(true);
      expect(s.decimals).toBe(8);
      expect(s.symbol.endsWith("x")).toBe(true);
    }
  });

  it("has no duplicate mints or symbols", () => {
    expect(new Set(XSTOCKS.map((s) => s.mint)).size).toBe(XSTOCKS.length);
    expect(new Set(XSTOCKS.map((s) => s.symbol)).size).toBe(XSTOCKS.length);
  });

  it("isXStockMint accepts listed mints, rejects everything else", () => {
    expect(isXStockMint(XSTOCKS[0].mint)).toBe(true);
    expect(isXStockMint("11111111111111111111111111111111")).toBe(false);
    expect(isXStockMint(undefined)).toBe(false);
    expect(isXStockMint(null)).toBe(false);
    expect(isXStockMint("")).toBe(false);
  });

  it("looks up by mint and by symbol (case-insensitive)", () => {
    const aapl = xstockByMint("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
    expect(aapl?.symbol).toBe("AAPLx");
    expect(xstockBySymbol("aaplx")?.mint).toBe(aapl?.mint);
    expect(xstockBySymbol("AAPLX")?.mint).toBe(aapl?.mint);
    expect(xstockBySymbol("nope")).toBeUndefined();
  });
});
