import { describe, expect, it } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  decodeV3Swap,
  isTokenZero,
  priceFromSqrtX96,
  toInt256,
  V3_SELECTORS,
  V3_SIGNATURES,
  V3_SWAP_TOPIC0,
  wordAt,
} from "./pons-pool";

const hash = (sig: string) => Buffer.from(keccak_256(new TextEncoder().encode(sig))).toString("hex");
const sel = (sig: string) => hash(sig).slice(0, 8);

const TOKEN = "0x1111111111111111111111111111111111111111";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

describe("selectors and topics are derived, not typed from memory", () => {
  it("every selector is the keccak of its signature", () => {
    expect(sel(V3_SIGNATURES.getPool)).toBe(V3_SELECTORS.getPool);
    expect(sel(V3_SIGNATURES.slot0)).toBe(V3_SELECTORS.slot0);
    expect(sel(V3_SIGNATURES.balanceOf)).toBe(V3_SELECTORS.balanceOf);
    expect(sel(V3_SIGNATURES.graduationStatus)).toBe(V3_SELECTORS.graduationStatus);
  });
  it("the Swap topic is the keccak of the full event signature", () => {
    expect("0x" + hash(V3_SIGNATURES.swapEvent)).toBe(V3_SWAP_TOPIC0);
  });
});

describe("toInt256", () => {
  it("reads a positive word", () => {
    expect(toInt256("0".repeat(63) + "5")).toBe(BigInt(5));
  });
  it("reads a negative (two's complement) word — v3 amounts are signed", () => {
    expect(toInt256("f".repeat(64))).toBe(BigInt(-1));
  });
  it("is zero for junk rather than throwing", () => {
    expect(toInt256("nope")).toBe(BigInt(0));
  });
});

describe("priceFromSqrtX96", () => {
  // sqrtPriceX96 for price = 1 is exactly 2^96.
  const ONE = BigInt(1) << BigInt(96); // 2^96

  it("price 1 when the pool is at parity", () => {
    expect(priceFromSqrtX96(ONE, { isToken0: true })).toBeCloseTo(1, 10);
  });

  it("INVERTS when the launched token is token1 — the bug that shows 1e6 ETH", () => {
    // sqrt(4)*2^96 ⇒ ratio 4. As token0 the token is worth 4; as token1, 0.25.
    const four = BigInt(2) * ONE;
    expect(priceFromSqrtX96(four, { isToken0: true })).toBeCloseTo(4, 8);
    expect(priceFromSqrtX96(four, { isToken0: false })).toBeCloseTo(0.25, 8);
  });

  it("handles a realistic tiny price without underflowing to zero", () => {
    // 1e-9 ETH per token: sqrt(1e-9) * 2^96
    const sqrt = BigInt(Math.floor(Math.sqrt(1e-9) * 2 ** 96));
    const p = priceFromSqrtX96(sqrt, { isToken0: true });
    expect(p).toBeGreaterThan(0);
    expect(p).toBeCloseTo(1e-9, 12);
  });

  it("is 0 for an uninitialised pool rather than NaN/Infinity", () => {
    expect(priceFromSqrtX96(BigInt(0), { isToken0: true })).toBe(0);
    expect(priceFromSqrtX96(BigInt(-1), { isToken0: true })).toBe(0);
  });
});

describe("isTokenZero", () => {
  it("sorts by address like every v3 pool, case-insensitively", () => {
    expect(isTokenZero("0x0000000000000000000000000000000000000001", WETH)).toBe(true);
    expect(isTokenZero("0xffffffffffffffffffffffffffffffffffffffff", WETH)).toBe(false);
    expect(isTokenZero(WETH.toUpperCase(), WETH.toLowerCase())).toBe(false);
  });
});

describe("decodeV3Swap", () => {
  const neg = (v: bigint) => ((BigInt(1) << BigInt(256)) + v).toString(16).padStart(64, "0");
  const pos = (v: bigint) => v.toString(16).padStart(64, "0");
  const RECIPIENT = "0x" + "22".repeat(20);

  const log = (amount0: string, amount1: string): Parameters<typeof decodeV3Swap>[0] => ({
    topics: [V3_SWAP_TOPIC0, "0x" + "11".repeat(32), "0x".padEnd(26, "0") + RECIPIENT.slice(2)],
    data: "0x" + amount0 + amount1 + "0".repeat(64 * 5),
    transactionHash: "0x" + "ab".repeat(32),
    blockNumber: "0x10",
  });

  it("a BUY is the pool RECEIVING the pair token (token as token0)", () => {
    // pool sends token out (negative), receives ETH (positive)
    const out = decodeV3Swap(log(neg(BigInt(-1000)), pos(BigInt(7))), { isToken0: true });
    expect(out?.isBuy).toBe(true);
    expect(out?.tokenWei).toBe(BigInt(1000));
    expect(out?.ethWei).toBe(BigInt(7));
  });

  it("a SELL is the pool paying the pair token out", () => {
    const out = decodeV3Swap(log(pos(BigInt(1000)), neg(BigInt(-7))), { isToken0: true });
    expect(out?.isBuy).toBe(false);
  });

  it("respects ordering — the same log flips meaning when the token is token1", () => {
    // Reading it from the wrong side announces every sell as a buy.
    const raw = log(neg(BigInt(-1000)), pos(BigInt(7)));
    expect(decodeV3Swap(raw, { isToken0: true })?.isBuy).toBe(true);
    expect(decodeV3Swap(raw, { isToken0: false })?.isBuy).toBe(false);
  });

  it("ignores a log that isn't a Swap", () => {
    expect(decodeV3Swap({ topics: ["0xdead"], data: "0x" }, { isToken0: true })).toBeNull();
    expect(decodeV3Swap({}, { isToken0: true })).toBeNull();
  });

  it("ignores a truncated Swap payload", () => {
    expect(
      decodeV3Swap({ topics: [V3_SWAP_TOPIC0], data: "0x" + "0".repeat(64) }, { isToken0: true })
    ).toBeNull();
  });

  it("carries the tx hash and recipient through for dedupe + display", () => {
    const out = decodeV3Swap(log(neg(BigInt(-1)), pos(BigInt(1))), { isToken0: true });
    expect(out?.txHash).toBe("0x" + "ab".repeat(32));
    expect(out?.recipient?.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(out?.blockNumber).toBe(16);
  });
});

describe("wordAt", () => {
  it("slices 32-byte words with or without the 0x prefix", () => {
    const data = "0x" + "11".repeat(32) + "22".repeat(32);
    expect(wordAt(data, 0)).toBe("11".repeat(32));
    expect(wordAt(data, 1)).toBe("22".repeat(32));
  });
});
