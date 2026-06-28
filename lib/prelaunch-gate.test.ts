import { describe, it, expect } from "vitest";
import {
  gateFeeLamports,
  gateLoopAmount,
  gateWallet,
  gateLoopMint,
  gateLoopRequired,
  gateFeeRequired,
  gateRequired,
} from "./prelaunch-gate";

const W = "7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9";
const MINT = "BXdPPjvdWpUQiETTbynVS587BeMCaL2JF6XRM1QJUNTH";

describe("gate config (disabled by default)", () => {
  it("is OFF when nothing is set", () => {
    expect(gateRequired({})).toBe(false);
    expect(gateFeeLamports({})).toBe(BigInt(0));
    expect(gateLoopAmount({})).toBe(0);
    expect(gateWallet({})).toBeNull();
  });

  it("parses a positive SOL fee to lamports", () => {
    expect(gateFeeLamports({ GATE_FEE_SOL: "0.1" })).toBe(BigInt(100_000_000));
    expect(gateFeeLamports({ GATE_FEE_SOL: "0" })).toBe(BigInt(0));
    expect(gateFeeLamports({ GATE_FEE_SOL: "-1" })).toBe(BigInt(0));
    expect(gateFeeLamports({ GATE_FEE_SOL: "x" })).toBe(BigInt(0));
  });

  it("parses the LOOP amount", () => {
    expect(gateLoopAmount({ GATE_LOOP_AMOUNT: "1000000" })).toBe(1_000_000);
    expect(gateLoopAmount({ GATE_LOOP_AMOUNT: "0" })).toBe(0);
  });

  it("falls back GATE_WALLET → PLATFORM_WALLET, and rejects malformed", () => {
    expect(gateWallet({ GATE_WALLET: W })).toBe(W);
    expect(gateWallet({ PLATFORM_WALLET: W })).toBe(W);
    expect(gateWallet({ GATE_WALLET: "nope" })).toBeNull();
  });

  it("falls back GATE_LOOP_MINT → LOOP_MINT", () => {
    expect(gateLoopMint({ GATE_LOOP_MINT: MINT })).toBe(MINT);
    expect(gateLoopMint({ LOOP_MINT: MINT })).toBe(MINT);
    expect(gateLoopMint({})).toBeNull();
  });
});

describe("gateRequired", () => {
  it("needs a wallet AND at least one leg", () => {
    expect(gateRequired({ GATE_FEE_SOL: "0.1" })).toBe(false); // no wallet
    expect(gateRequired({ GATE_WALLET: W })).toBe(false); // no leg
    expect(gateRequired({ GATE_WALLET: W, GATE_FEE_SOL: "0.1" })).toBe(true);
    expect(gateRequired({ GATE_WALLET: W, GATE_LOOP_AMOUNT: "1000000", LOOP_MINT: MINT })).toBe(true);
  });

  it("the LOOP leg needs both an amount and a mint", () => {
    expect(gateLoopRequired({ GATE_LOOP_AMOUNT: "1000000" })).toBe(false); // no mint
    expect(gateLoopRequired({ GATE_LOOP_AMOUNT: "1000000", LOOP_MINT: MINT })).toBe(true);
    expect(gateFeeRequired({ GATE_FEE_SOL: "0.1" })).toBe(true);
  });

  it("the full intended config (1M LOOP + SOL fee) is required", () => {
    const env = { GATE_WALLET: W, GATE_FEE_SOL: "0.05", GATE_LOOP_AMOUNT: "1000000", LOOP_MINT: MINT };
    expect(gateRequired(env)).toBe(true);
    expect(gateFeeRequired(env)).toBe(true);
    expect(gateLoopRequired(env)).toBe(true);
  });
});
