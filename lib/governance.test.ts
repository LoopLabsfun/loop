import { describe, it, expect } from "vitest";
import {
  votePassed,
  canWithdraw,
  windDownDistribution,
} from "./governance";

describe("votePassed", () => {
  it("passes only with quorum met AND a strict majority for", () => {
    // 70 + 20 = 90 total ≥ quorum 80, and 70 > 20 → passes.
    expect(votePassed({ forVotes: 70, againstVotes: 20, quorum: 80 })).toBe(true);
  });
  it("fails when quorum is not reached", () => {
    expect(votePassed({ forVotes: 40, againstVotes: 10, quorum: 100 })).toBe(false);
  });
  it("fails on a tie or when against wins", () => {
    expect(votePassed({ forVotes: 50, againstVotes: 50, quorum: 100 })).toBe(false);
    expect(votePassed({ forVotes: 40, againstVotes: 60, quorum: 100 })).toBe(false);
  });
});

describe("canWithdraw", () => {
  // 70 + 20 = 90 total ≥ quorum 80, and 70 > 20 → a genuinely passing vote.
  const passingVote = { forVotes: 70, againstVotes: 20, quorum: 80 };

  it("approves a positive, in-balance amount with a passed vote", () => {
    expect(canWithdraw(10, { amountSol: 4, recipient: "x", vote: passingVote }).ok).toBe(
      true
    );
  });
  it("rejects a non-positive amount", () => {
    expect(canWithdraw(10, { amountSol: 0, recipient: "x", vote: passingVote }).ok).toBe(
      false
    );
  });
  it("rejects more than the treasury holds", () => {
    const r = canWithdraw(3, { amountSol: 5, recipient: "x", vote: passingVote });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exceeds/);
  });
  it("rejects a withdrawal whose vote has not passed (never unilateral)", () => {
    const r = canWithdraw(10, {
      amountSol: 4,
      recipient: "x",
      vote: { forVotes: 1, againstVotes: 0, quorum: 100 },
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/vote/);
  });
});

describe("windDownDistribution (no stuck funds)", () => {
  it("splits pro-rata by share and sums to the treasury exactly", () => {
    const out = windDownDistribution(9, [
      { address: "a", share: 0.5 },
      { address: "b", share: 0.3 },
      { address: "c", share: 0.2 },
    ]);
    expect(out.map((p) => p.address)).toEqual(["a", "b", "c"]);
    expect(out.reduce((s, p) => s + p.sol, 0)).toBeCloseTo(9, 9);
    expect(out[0].sol).toBeCloseTo(4.5, 9);
  });
  it("normalises shares that don't sum to 1", () => {
    const out = windDownDistribution(10, [
      { address: "a", share: 2 },
      { address: "b", share: 2 },
    ]);
    expect(out[0].sol).toBeCloseTo(5, 9);
    expect(out.reduce((s, p) => s + p.sol, 0)).toBeCloseTo(10, 9);
  });
  it("absorbs rounding dust so nothing is left behind", () => {
    const out = windDownDistribution(1, [
      { address: "a", share: 1 / 3 },
      { address: "b", share: 1 / 3 },
      { address: "c", share: 1 / 3 },
    ]);
    expect(out.reduce((s, p) => s + p.sol, 0)).toBe(1);
  });
  it("returns nothing for an empty treasury or no holders", () => {
    expect(windDownDistribution(0, [{ address: "a", share: 1 }])).toEqual([]);
    expect(windDownDistribution(5, [])).toEqual([]);
  });
});
