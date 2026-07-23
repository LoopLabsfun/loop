import { describe, expect, it } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3";
import { PONS_SELECTORS, PONS_SIGNATURES, PONS_LOCKER, PONS_PAIR_TOKEN } from "./pons";
import { encodeCollectFees, decodeFeesClaimed, FEES_CLAIMED_TOPIC0 } from "./pons-fees";

const sel = (sig: string) =>
  Buffer.from(keccak_256(new TextEncoder().encode(sig))).toString("hex").slice(0, 8);

describe("Pons fee selectors", () => {
  // The same guard that already caught two wrong constants in this file — and
  // caught all three of these when they were first hand-written.
  it("collect/read selectors are the keccak of their signatures", () => {
    expect(sel(PONS_SIGNATURES.collectFees)).toBe(PONS_SELECTORS.collectFees);
    expect(sel(PONS_SIGNATURES.protocolFeeShare)).toBe(PONS_SELECTORS.protocolFeeShare);
    expect(sel(PONS_SIGNATURES.feeRedirects)).toBe(PONS_SELECTORS.feeRedirects);
  });
});

describe("encodeCollectFees", () => {
  const token = "0xb06e7ccd713174885311eff6f8eacecae65e963b";

  it("encodes selector + 32-byte left-padded address", () => {
    const data = encodeCollectFees(token);
    expect(data).toBe(
      "0x" + PONS_SELECTORS.collectFees + "000000000000000000000000" + token.slice(2)
    );
    expect(data).toHaveLength(2 + 8 + 64);
  });

  it("normalizes case (checksummed input encodes identically)", () => {
    expect(encodeCollectFees("0xB06E7cCd713174885311EfF6f8eAceCae65e963b")).toBe(
      encodeCollectFees(token)
    );
  });

  it("refuses anything that isn't a 20-byte address", () => {
    expect(() => encodeCollectFees("0x123")).toThrow();
    expect(() => encodeCollectFees("not-an-address")).toThrow();
    // A 32-byte value must not silently pass as an address.
    expect(() => encodeCollectFees("0x" + "a".repeat(64))).toThrow();
  });

  it("targets the locker, not the factory (fees live on the locker)", () => {
    expect(PONS_LOCKER).toBe("0x736D76699C26D0d966744cAe304C000d471f7F35");
  });
});

describe("decodeFeesClaimed", () => {
  const token = "0xb06e7ccd713174885311eff6f8eacecae65e963b";
  const w = (n: bigint | string) =>
    (typeof n === "bigint" ? n.toString(16) : n.replace(/^0x/, "")).padStart(64, "0");

  /** token0, token1, recipient0, recipient1, protocol0, protocol1 */
  const makeLog = (token0: string, token1: string, r0: bigint, r1: bigint) => ({
    address: PONS_LOCKER,
    topics: [FEES_CLAIMED_TOPIC0, "0x" + w(token), "0x" + w("0xcafe")],
    data:
      "0x" + w(token0) + w(token1) + w(r0) + w(r1) + w(BigInt(0)) + w(BigInt(0)),
  });

  it("reads the WETH side when WETH is token0", () => {
    const d = decodeFeesClaimed(makeLog(PONS_PAIR_TOKEN, token, BigInt(7), BigInt(9)))!;
    expect(d.recipientWethWei).toBe(BigInt(7));
    expect(d.recipientTokenUnits).toBe(BigInt(9));
    expect(d.token.toLowerCase()).toBe(token);
  });

  it("reads the WETH side when WETH is token1 (sort order flipped)", () => {
    const d = decodeFeesClaimed(makeLog(token, PONS_PAIR_TOKEN, BigInt(7), BigInt(9)))!;
    // Amounts must follow the token, not the slot — this is the bug that would
    // otherwise credit the treasury $LOOP as if it were ETH.
    expect(d.recipientWethWei).toBe(BigInt(9));
    expect(d.recipientTokenUnits).toBe(BigInt(7));
  });

  it("ignores logs from another contract, even with the right topic", () => {
    const log = makeLog(PONS_PAIR_TOKEN, token, BigInt(1), BigInt(1));
    expect(decodeFeesClaimed({ ...log, address: "0x" + "9".repeat(40) })).toBeNull();
  });

  it("ignores other events from the locker", () => {
    const log = makeLog(PONS_PAIR_TOKEN, token, BigInt(1), BigInt(1));
    expect(decodeFeesClaimed({ ...log, topics: ["0x" + "1".repeat(64)] })).toBeNull();
  });

  it("ignores a truncated data block instead of decoding garbage", () => {
    const log = makeLog(PONS_PAIR_TOKEN, token, BigInt(1), BigInt(1));
    expect(decodeFeesClaimed({ ...log, data: "0x" + "0".repeat(64) })).toBeNull();
  });
});
