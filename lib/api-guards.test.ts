import { describe, it, expect } from "vitest";
import { isSolanaAddress, parseAmount, clampSlippage } from "./api-guards";

// A real mainnet mint (LOOP-shaped vanity address) and the SOL mint — both valid.
const REAL_MINT = "So11111111111111111111111111111111111111112";

describe("isSolanaAddress", () => {
  it("accepts a well-formed base58 address", () => {
    expect(isSolanaAddress(REAL_MINT)).toBe(true);
    expect(isSolanaAddress("7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9")).toBe(true);
  });

  it("rejects non-strings and empty", () => {
    expect(isSolanaAddress(undefined)).toBe(false);
    expect(isSolanaAddress(null)).toBe(false);
    expect(isSolanaAddress(123)).toBe(false);
    expect(isSolanaAddress("")).toBe(false);
  });

  it("rejects too short / too long", () => {
    expect(isSolanaAddress("abc")).toBe(false);
    expect(isSolanaAddress("1".repeat(45))).toBe(false);
  });

  it("rejects base58-illegal characters (0 O I l) and url/path injection", () => {
    expect(isSolanaAddress("0OIl" + "1".repeat(28))).toBe(false);
    expect(isSolanaAddress("../../../etc/passwd")).toBe(false);
    expect(isSolanaAddress("http://evil.example.com/" + "1".repeat(20))).toBe(false);
    expect(isSolanaAddress(REAL_MINT + "?x=1")).toBe(false);
  });
});

describe("parseAmount", () => {
  it("accepts positive finite numbers and numeric strings", () => {
    expect(parseAmount(0.1)).toBe(0.1);
    expect(parseAmount("2.5")).toBe(2.5);
  });

  it("rejects zero, negatives, NaN, and Infinity", () => {
    expect(parseAmount(0)).toBeNull();
    expect(parseAmount(-1)).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount(Infinity)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });

  it("enforces the cap", () => {
    expect(parseAmount(1_000_000)).toBe(1_000_000);
    expect(parseAmount(1_000_001)).toBeNull();
    expect(parseAmount(5, 4)).toBeNull();
  });
});

describe("clampSlippage", () => {
  it("passes through in-range values", () => {
    expect(clampSlippage(10)).toBe(10);
    expect(clampSlippage("25")).toBe(25);
  });

  it("clamps out-of-range and falls back on garbage", () => {
    expect(clampSlippage(500)).toBe(100);
    expect(clampSlippage(-5)).toBe(0);
    expect(clampSlippage("nope")).toBe(10);
    expect(clampSlippage(undefined, 7)).toBe(7);
  });
});
