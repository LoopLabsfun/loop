import { describe, it, expect } from "vitest";
import {
  DEFAULT_SPLIT,
  PLATFORM_PCT,
  MAX_FOUNDER_PCT,
  makeSplit,
  isValidSplit,
  distribute,
  splitLabel,
} from "./fees";

describe("DEFAULT_SPLIT", () => {
  it("is the agreed 30 / 65 / 5 and is valid", () => {
    expect(DEFAULT_SPLIT).toEqual({ founderPct: 30, agentPct: 65, platformPct: 5 });
    expect(isValidSplit(DEFAULT_SPLIT)).toBe(true);
  });
});

describe("makeSplit", () => {
  it("keeps platform fixed and gives the agent the remainder", () => {
    expect(makeSplit(30)).toEqual({ founderPct: 30, agentPct: 65, platformPct: 5 });
    expect(makeSplit(70)).toEqual({ founderPct: 70, agentPct: 25, platformPct: 5 });
    expect(makeSplit(0)).toEqual({ founderPct: 0, agentPct: 95, platformPct: 5 });
  });
  it("clamps the founder share into range and always sums to 100", () => {
    const hi = makeSplit(200);
    expect(hi.founderPct).toBe(MAX_FOUNDER_PCT);
    expect(hi.founderPct + hi.agentPct + hi.platformPct).toBe(100);
    const lo = makeSplit(-50);
    expect(lo.founderPct).toBe(0);
    expect(lo.founderPct + lo.agentPct + lo.platformPct).toBe(100);
  });
  it("rounds fractional input to an integer split", () => {
    expect(makeSplit(30.6).founderPct).toBe(31);
  });
});

describe("isValidSplit", () => {
  it("rejects splits that don't sum to 100", () => {
    expect(isValidSplit({ founderPct: 30, agentPct: 60, platformPct: 5 })).toBe(false);
  });
  it("rejects negative or non-integer shares", () => {
    expect(isValidSplit({ founderPct: -5, agentPct: 100, platformPct: 5 })).toBe(false);
    expect(isValidSplit({ founderPct: 30.5, agentPct: 64.5, platformPct: 5 })).toBe(false);
  });
});

describe("distribute", () => {
  it("splits an amount per the share and re-sums exactly", () => {
    const d = distribute(10, DEFAULT_SPLIT);
    expect(d.founderSol).toBeCloseTo(3, 9);
    expect(d.agentSol).toBeCloseTo(6.5, 9);
    expect(d.platformSol).toBeCloseTo(0.5, 9);
    expect(d.founderSol + d.agentSol + d.platformSol).toBeCloseTo(10, 9);
  });
  it("never loses or creates dust — remainder lands on the agent", () => {
    const amt = 1 / 3; // awkward float
    const d = distribute(amt, DEFAULT_SPLIT);
    expect(d.founderSol + d.agentSol + d.platformSol).toBeCloseTo(amt, 9);
  });
  it("falls back to the default split when given an invalid one", () => {
    const bad = { founderPct: 50, agentPct: 50, platformPct: 50 };
    const d = distribute(10, bad);
    expect(d.platformSol).toBeCloseTo(0.5, 9); // used 5%, not 50%
  });
  it("treats a non-positive amount as zero", () => {
    expect(distribute(-3, DEFAULT_SPLIT)).toEqual({
      founderSol: 0,
      agentSol: 0,
      platformSol: 0,
    });
  });
});

describe("splitLabel", () => {
  it("formats as founder / agent / platform", () => {
    expect(splitLabel(DEFAULT_SPLIT)).toBe("30 / 65 / 5");
    expect(PLATFORM_PCT).toBe(5);
  });
});
