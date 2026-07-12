import { describe, expect, it } from "vitest";

import {
  HOOD_CHAIN_ID,
  chainInfo,
  chainOfAddress,
  isAddressForChain,
} from "./registry";
import { isChain } from "./types";

// Wrapped-SOL mint — a well-known, validly shaped base58 pubkey.
const SOL_ADDR = "So11111111111111111111111111111111111111112";
const EVM_ADDR = "0x52908400098527886E0F7030069857D2E4169EE7";

describe("chain registry", () => {
  it("exposes native symbols + explorer links per chain", () => {
    expect(chainInfo("solana").nativeSymbol).toBe("SOL");
    expect(chainInfo("hood").nativeSymbol).toBe("ETH");
    expect(chainInfo("hood").evmChainId).toBe(HOOD_CHAIN_ID);
    expect(chainInfo("hood").explorerTx("0xabc")).toContain("blockscout");
    expect(chainInfo("solana").explorerAddress("abc")).toContain("solscan.io");
  });

  it("validates address shape per chain", () => {
    expect(isAddressForChain(EVM_ADDR, "hood")).toBe(true);
    expect(isAddressForChain(EVM_ADDR, "solana")).toBe(false);
    expect(isAddressForChain(SOL_ADDR, "solana")).toBe(true);
    expect(isAddressForChain(SOL_ADDR, "hood")).toBe(false);
    expect(isAddressForChain("0x123", "hood")).toBe(false);
  });

  it("infers a chain from an address shape", () => {
    expect(chainOfAddress(EVM_ADDR)).toBe("hood");
    expect(chainOfAddress("not-an-address!")).toBe(null);
  });

  it("guards the Chain union", () => {
    expect(isChain("solana")).toBe(true);
    expect(isChain("hood")).toBe(true);
    expect(isChain("devnet")).toBe(false);
  });
});
