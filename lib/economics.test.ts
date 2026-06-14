import { describe, it, expect } from "vitest";
import {
  parseSolPerDay,
  modelTier,
  infraBreakdown,
  feeCoverage,
  type CostKey,
} from "./economics";
import type { Project } from "./types";

const base: Project = {
  key: "demo" as Project["key"],
  name: "Demo Co",
  ticker: "$DEMO",
  description: "A demo project.",
  official: false,
  launchpad: "Pump.fun",
  repo: "github.com/x/demo",
  cover: "neon",
  price: 0.0001,
  marketCap: "$30K",
  liquidity: "$4K",
  holders: "1",
  volume24h: "0 SOL",
  curve: 0.02,
  supply: "1B",
  treasurySol: 0,
  earnedSol: 0,
  burnPerDay: "0.30 SOL/day",
  runway: "booting",
};

describe("parseSolPerDay", () => {
  it("parses a formatted snapshot", () => {
    expect(parseSolPerDay("0.42 SOL/day")).toBeCloseTo(0.42, 6);
  });
  it("passes through a raw number", () => {
    expect(parseSolPerDay(0.18)).toBe(0.18);
  });
  it("treats missing / garbage / negative as 0", () => {
    expect(parseSolPerDay(null)).toBe(0);
    expect(parseSolPerDay(undefined)).toBe(0);
    expect(parseSolPerDay("n/a")).toBe(0);
    expect(parseSolPerDay(-1)).toBe(0);
  });
});

describe("modelTier", () => {
  it("runs Opus for official projects, Sonnet otherwise", () => {
    expect(modelTier(base)).toBe("Sonnet");
    expect(modelTier({ ...base, official: true })).toBe("Opus");
  });
});

describe("infraBreakdown", () => {
  const solUsd = 164;

  it("itemises the burn into compute/email/social/hosting", () => {
    const b = infraBreakdown(base, solUsd);
    const keys = b.items.map((i) => i.key);
    expect(keys).toEqual<CostKey[]>([
      "compute",
      "email",
      "social",
      "hosting",
    ]);
  });

  it("line items always sum back to the burn (explains, never invents)", () => {
    const b = infraBreakdown(base, solUsd);
    const sumSol = b.items.reduce((a, i) => a + i.solPerDay, 0);
    expect(sumSol).toBeCloseTo(parseSolPerDay(base.burnPerDay), 9);
    expect(sumSol).toBeCloseTo(b.solPerDay, 9);

    const shareSum = b.items.reduce((a, i) => a + i.share, 0);
    expect(shareSum).toBeCloseTo(1, 9);
  });

  it("converts SOL/day to USD/month consistently", () => {
    const b = infraBreakdown(base, solUsd);
    expect(b.usdPerMonth).toBeCloseTo(b.solPerDay * 30 * solUsd, 6);
    for (const i of b.items) {
      expect(i.usdPerMonth).toBeCloseTo(i.solPerDay * 30 * solUsd, 6);
    }
  });

  it("weights compute more heavily as the model tier rises", () => {
    const sonnet = infraBreakdown(base, solUsd);
    const opus = infraBreakdown({ ...base, official: true }, solUsd);
    const computeShare = (b: ReturnType<typeof infraBreakdown>) =>
      b.items.find((i) => i.key === "compute")!.share;
    expect(computeShare(opus)).toBeGreaterThan(computeShare(sonnet));
  });

  it("keeps X off by default and notes it as paid when enabled", () => {
    const off = infraBreakdown(base, solUsd);
    const on = infraBreakdown(base, solUsd, { xEnabled: true });
    const social = (b: ReturnType<typeof infraBreakdown>) =>
      b.items.find((i) => i.key === "social")!.detail;
    expect(off.xEnabled).toBe(false);
    expect(social(off)).not.toMatch(/X \(paid\)/);
    expect(on.xEnabled).toBe(true);
    expect(social(on)).toMatch(/X \(paid\)/);
  });
});

describe("feeCoverage", () => {
  it("is the income-to-burn ratio", () => {
    expect(feeCoverage(0.84, 0.42)).toBeCloseTo(2, 9);
  });
  it("clamps negative income to 0 and treats a zero burn as fully covered", () => {
    expect(feeCoverage(-5, 0.42)).toBe(0);
    expect(feeCoverage(1, 0)).toBe(Infinity);
  });
});
