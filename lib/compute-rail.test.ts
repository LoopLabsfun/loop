import { describe, it, expect, afterEach } from "vitest";
import {
  ZERO_LEDGER,
  DEFAULT_SWAP_FEE_BPS,
  creditBalanceUsd,
  recordTopUp,
  recordSpend,
  convertSolToCredits,
  planTopUp,
  computeRailEnabled,
} from "./compute-rail";

describe("compute ledger (credited − consumed)", () => {
  it("starts empty", () => {
    expect(creditBalanceUsd(ZERO_LEDGER)).toBe(0);
  });
  it("accumulates top-ups and spend", () => {
    let l = recordTopUp(ZERO_LEDGER, 100);
    l = recordSpend(l, 30);
    l = recordSpend(l, 10);
    expect(l.creditedUsd).toBe(100);
    expect(l.consumedUsd).toBe(40);
    expect(creditBalanceUsd(l)).toBe(60);
  });
  it("clamps negative inputs to zero (never invents or refunds credit)", () => {
    let l = recordTopUp(ZERO_LEDGER, -50);
    l = recordSpend(l, -5);
    expect(l).toEqual(ZERO_LEDGER);
  });
  it("can go negative when over-drawn (runtime reads this as 'top up or sleep')", () => {
    const l = recordSpend(recordTopUp(ZERO_LEDGER, 10), 14);
    expect(creditBalanceUsd(l)).toBe(-4);
  });
});

describe("convertSolToCredits", () => {
  it("applies the swap/ramp fee: 1 SOL @ $164, 1% fee → $162.36", () => {
    const c = convertSolToCredits(1, 164, 100);
    expect(c.usdGross).toBe(164);
    expect(c.feeUsd).toBe(1.64);
    expect(c.usdCredited).toBe(162.36);
  });
  it("uses the default fee + SOL_USD when omitted", () => {
    const c = convertSolToCredits(1);
    expect(c.feeUsd).toBeCloseTo((164 * DEFAULT_SWAP_FEE_BPS) / 10_000, 2);
    expect(c.usdCredited).toBeLessThan(c.usdGross);
  });
  it("zero/negative SOL yields zero credit", () => {
    expect(convertSolToCredits(0).usdCredited).toBe(0);
    expect(convertSolToCredits(-3).usdCredited).toBe(0);
  });
});

describe("planTopUp (funded only from the agent's own share)", () => {
  it("does nothing when the balance already meets the target", () => {
    const p = planTopUp({ balanceUsd: 50, targetUsd: 50, availableAgentSol: 10 });
    expect(p.solToConvert).toBe(0);
    expect(p.reason).toMatch(/already at target/);
  });
  it("does nothing when the agent has no claimable SOL — never touches other shares", () => {
    const p = planTopUp({ balanceUsd: 0, targetUsd: 100, availableAgentSol: 0 });
    expect(p.solToConvert).toBe(0);
    expect(p.reason).toMatch(/no agent-share SOL/);
  });
  it("converts enough (grossed up for the fee) to hit the target", () => {
    // deficit $162.36, 1% fee → needs ~1 SOL @ $164 to net $162.36 credit.
    const p = planTopUp({
      balanceUsd: 0,
      targetUsd: 162.36,
      availableAgentSol: 10,
      solUsd: 164,
      feeBps: 100,
    });
    expect(p.solToConvert).toBeCloseTo(1, 6);
    expect(p.usdCredited).toBeCloseTo(162.36, 1);
  });
  it("is hard-capped by the agent's available SOL (partial top-up)", () => {
    const p = planTopUp({
      balanceUsd: 0,
      targetUsd: 10_000,
      availableAgentSol: 0.5,
      solUsd: 164,
      feeBps: 100,
    });
    expect(p.solToConvert).toBe(0.5);
    expect(p.usdCredited).toBeLessThan(10_000);
    expect(p.reason).toMatch(/partial top-up/);
  });
});

describe("computeRailEnabled (execution gate)", () => {
  const prev = process.env.COMPUTE_RAIL_PROVIDER;
  afterEach(() => {
    if (prev === undefined) delete process.env.COMPUTE_RAIL_PROVIDER;
    else process.env.COMPUTE_RAIL_PROVIDER = prev;
  });
  it("is off by default (prototype — no real conversion)", () => {
    delete process.env.COMPUTE_RAIL_PROVIDER;
    expect(computeRailEnabled()).toBe(false);
  });
  it("is on when a provider is configured", () => {
    process.env.COMPUTE_RAIL_PROVIDER = "anthropic";
    expect(computeRailEnabled()).toBe(true);
  });
});
