import { describe, it, expect } from "vitest";
import { tickCostSol, canAffordTick, agentRunState, MIN_TREASURY_SOL, TICKS_PER_DAY, crossChainTreasurySol } from "./budget";

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

describe("crossChainTreasurySol", () => {
  const fx = { solUsd: 140, ethUsd: 3500 };

  it("sums a single Solana deployment unchanged", () => {
    expect(crossChainTreasurySol([{ chain: "solana", treasuryNative: 2 }], fx)).toBeCloseTo(2);
  });

  it("converts a Hood (ETH) treasury into SOL-equivalent", () => {
    // 0.1 ETH = $350 = 2.5 SOL at $140.
    expect(crossChainTreasurySol([{ chain: "hood", treasuryNative: 0.1 }], fx)).toBeCloseTo(2.5);
  });

  it("adds both chains — funding EITHER extends the same runway", () => {
    const total = crossChainTreasurySol(
      [
        { chain: "solana", treasuryNative: 1 },
        { chain: "hood", treasuryNative: 0.1 },
      ],
      fx
    );
    expect(total).toBeCloseTo(3.5);
  });

  it("contributes 0 for a chain it cannot price rather than inventing a value", () => {
    const noEth = crossChainTreasurySol(
      [
        { chain: "solana", treasuryNative: 1 },
        { chain: "hood", treasuryNative: 5 },
      ],
      { solUsd: 140, ethUsd: 0 }
    );
    expect(noEth).toBeCloseTo(1);
  });

  it("is 0 when SOL itself cannot be priced (gate errs toward sleeping)", () => {
    expect(
      crossChainTreasurySol([{ chain: "solana", treasuryNative: 10 }], { solUsd: 0, ethUsd: 3500 })
    ).toBe(0);
  });

  it("ignores negative / non-finite balances", () => {
    expect(
      crossChainTreasurySol(
        [
          { chain: "solana", treasuryNative: -3 },
          { chain: "solana", treasuryNative: NaN },
          { chain: "solana", treasuryNative: 1 },
        ],
        fx
      )
    ).toBeCloseTo(1);
  });
});

describe("canAffordTick with a cross-chain total", () => {
  const burn = { burnPerDay: "0.24 SOL/day" }; // 0.01/cycle

  it("wakes a project funded only on its NON-home chain", () => {
    // Home (Solana) treasury is empty; the Hood treasury carries the runway.
    const asleep = canAffordTick({ ...burn, treasurySol: 0 });
    expect(asleep.ok).toBe(false);
    const awake = canAffordTick({ ...burn, treasurySol: 0, treasurySolTotal: 2.5 });
    expect(awake.ok).toBe(true);
  });

  it("still sleeps when the cross-chain total is also empty", () => {
    expect(canAffordTick({ ...burn, treasurySol: 0, treasurySolTotal: 0 }).ok).toBe(false);
  });

  it("falls back to treasurySol when no total was computed (single-chain)", () => {
    expect(canAffordTick({ ...burn, treasurySol: 1 }).ok).toBe(true);
  });
});
