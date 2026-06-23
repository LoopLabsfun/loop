import { describe, it, expect } from "vitest";
import {
  tickCostSol,
  canAffordTick,
  agentRunState,
  MIN_TREASURY_SOL,
  TICKS_PER_DAY,
} from "./budget";

describe("tickCostSol", () => {
  it("spreads the daily burn over the day's ticks", () => {
    expect(tickCostSol({ burnPerDay: "0.48 SOL/day" })).toBeCloseTo(0.48 / TICKS_PER_DAY);
  });
  it("is 0 for an unparseable / zero burn", () => {
    expect(tickCostSol({ burnPerDay: "—" })).toBe(0);
    expect(tickCostSol({ burnPerDay: "0 SOL/day" })).toBe(0);
  });
});

describe("canAffordTick (hard-stop)", () => {
  it("sleeps on an empty treasury", () => {
    const r = canAffordTick({ treasurySol: 0, burnPerDay: "0.24 SOL/day" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/sleeping/);
  });
  it("sleeps on a dust treasury below the floor", () => {
    expect(canAffordTick({ treasurySol: MIN_TREASURY_SOL / 2, burnPerDay: "0 SOL/day" }).ok).toBe(
      false
    );
  });
  it("treats null / NaN / negative balances as empty (sleep)", () => {
    expect(canAffordTick({ treasurySol: null as never, burnPerDay: "1 SOL/day" }).ok).toBe(false);
    expect(canAffordTick({ treasurySol: NaN, burnPerDay: "1 SOL/day" }).ok).toBe(false);
    expect(canAffordTick({ treasurySol: -5, burnPerDay: "1 SOL/day" }).ok).toBe(false);
  });
  it("sleeps when treasury can't cover one cycle's burn", () => {
    // burn 240 SOL/day ⇒ 10 SOL/cycle; 5 SOL treasury can't afford it.
    expect(canAffordTick({ treasurySol: 5, burnPerDay: "240 SOL/day" }).ok).toBe(false);
  });
  it("wakes when funded above the floor and the per-cycle cost", () => {
    const r = canAffordTick({ treasurySol: 2, burnPerDay: "0.48 SOL/day" });
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/funded/);
  });
});

describe("agentRunState", () => {
  it("is pre-launch until the token is minted (no market to run on)", () => {
    expect(
      agentRunState({ mint: null, treasurySol: 0, burnPerDay: "0.00 SOL/day" })
    ).toBe("pre-launch");
    // even a funded treasury is pre-launch with no mint
    expect(
      agentRunState({ mint: null, treasurySol: 9, burnPerDay: "0.48 SOL/day" })
    ).toBe("pre-launch");
  });
  it("is asleep when minted but the treasury can't afford a cycle", () => {
    expect(
      agentRunState({ mint: "Mint111", treasurySol: 0, burnPerDay: "0.48 SOL/day" })
    ).toBe("asleep");
  });
  it("is active when minted and the treasury funds cycles", () => {
    expect(
      agentRunState({ mint: "Mint111", treasurySol: 2, burnPerDay: "0.48 SOL/day" })
    ).toBe("active");
  });
});
