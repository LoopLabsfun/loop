import { describe, it, expect, vi, afterEach } from "vitest";
import { buildSwapTx } from "./pump";

const WALLET = "So11111111111111111111111111111111111111112";
const MINT   = "7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9";

afterEach(() => vi.unstubAllGlobals());

describe("buildSwapTx — client-side validation (no network)", () => {
  it("rejects an empty publicKey", async () => {
    await expect(
      buildSwapTx({ publicKey: "", action: "buy", mint: MINT, amount: 0.1 })
    ).rejects.toThrow("Connect your wallet to swap");
  });

  it("rejects an empty mint", async () => {
    await expect(
      buildSwapTx({ publicKey: WALLET, action: "buy", mint: "", amount: 0.1 })
    ).rejects.toThrow("Invalid token address");
  });

  it("rejects amount = 0", async () => {
    await expect(
      buildSwapTx({ publicKey: WALLET, action: "buy", mint: MINT, amount: 0 })
    ).rejects.toThrow("Enter an amount greater than zero");
  });

  it("rejects a negative amount", async () => {
    await expect(
      buildSwapTx({ publicKey: WALLET, action: "buy", mint: MINT, amount: -1 })
    ).rejects.toThrow("Enter an amount greater than zero");
  });

  it("rejects NaN amount", async () => {
    await expect(
      buildSwapTx({ publicKey: WALLET, action: "buy", mint: MINT, amount: NaN })
    ).rejects.toThrow("Enter an amount greater than zero");
  });

  it("rejects Infinity amount", async () => {
    await expect(
      buildSwapTx({ publicKey: WALLET, action: "buy", mint: MINT, amount: Infinity })
    ).rejects.toThrow("Enter an amount greater than zero");
  });

  it("rejects slippage outside [0, 100]", async () => {
    await expect(
      buildSwapTx({ publicKey: WALLET, action: "buy", mint: MINT, amount: 0.5, slippage: 200 })
    ).rejects.toThrow("Slippage must be between 0 and 100");
  });

  it("rejects NaN slippage", async () => {
    await expect(
      buildSwapTx({ publicKey: WALLET, action: "buy", mint: MINT, amount: 0.5, slippage: NaN })
    ).rejects.toThrow("Slippage must be between 0 and 100");
  });

  it("passes all guards and reaches fetch with valid args", async () => {
    // Stub fetch so we never hit the network. The stub returns an upstream error
    // to confirm execution passed our guards and reached the fetch call.
    vi.stubGlobal(
      "fetch",
      async () => ({ ok: false, json: async () => ({ error: "upstream" }) })
    );
    await expect(
      buildSwapTx({ publicKey: WALLET, action: "buy", mint: MINT, amount: 0.5 })
    ).rejects.toThrow("upstream");
  });
});
