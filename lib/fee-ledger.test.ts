import { describe, it, expect } from "vitest";
import {
  addDistribution,
  recordSweep,
  totalEarned,
  claimable,
  ZERO_TOTALS,
} from "./fee-ledger";
import { DEFAULT_SPLIT, makeSplit } from "./fees";

describe("recordSweep", () => {
  it("splits a swept amount by the default 30/65/5 and accumulates", () => {
    const after = recordSweep(ZERO_TOTALS, 10, DEFAULT_SPLIT);
    expect(after).toEqual({ founderSol: 3, agentSol: 6.5, platformSol: 0.5 });
    const after2 = recordSweep(after, 10, DEFAULT_SPLIT);
    expect(after2).toEqual({ founderSol: 6, agentSol: 13, platformSol: 1 });
  });

  it("respects a custom founder-favoured split", () => {
    expect(recordSweep(ZERO_TOTALS, 100, makeSplit(70))).toEqual({
      founderSol: 70,
      agentSol: 25,
      platformSol: 5,
    });
  });
});

describe("totalEarned / addDistribution", () => {
  it("sums a history of distributions (no dust drift)", () => {
    const ds = [
      { founderSol: 0.3, agentSol: 0.65, platformSol: 0.05 },
      { founderSol: 0.3, agentSol: 0.65, platformSol: 0.05 },
      { founderSol: 0.3, agentSol: 0.65, platformSol: 0.05 },
    ];
    expect(totalEarned(ds)).toEqual({ founderSol: 0.9, agentSol: 1.95, platformSol: 0.15 });
  });
  it("starts from zero", () => {
    expect(totalEarned([])).toEqual(ZERO_TOTALS);
  });
});

describe("claimable", () => {
  it("is earned minus already-claimed, per role", () => {
    const earned = { founderSol: 6, agentSol: 13, platformSol: 1 };
    const claimed = { founderSol: 3, agentSol: 13, platformSol: 0 };
    expect(claimable(earned, claimed)).toEqual({
      founderSol: 3,
      agentSol: 0,
      platformSol: 1,
    });
  });
  it("clamps to zero (never negative)", () => {
    const earned = { founderSol: 1, agentSol: 0, platformSol: 0 };
    const claimed = { founderSol: 2, agentSol: 0, platformSol: 0 };
    expect(claimable(earned, claimed).founderSol).toBe(0);
  });
});
