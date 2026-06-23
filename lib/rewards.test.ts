import { describe, it, expect } from "vitest";
import { airdropDistribution, canPayBounty, type Bounty } from "./rewards";

describe("airdropDistribution", () => {
  it("splits an amount pro-rata to holders, summing exactly", () => {
    const out = airdropDistribution(9, [
      { address: "a", share: 0.5 },
      { address: "b", share: 0.3 },
      { address: "c", share: 0.2 },
    ]);
    expect(out[0]).toEqual({ address: "a", sol: 4.5 });
    expect(out.reduce((s, p) => s + p.sol, 0)).toBeCloseTo(9, 9);
  });
  it("returns nothing for a zero amount or no holders", () => {
    expect(airdropDistribution(0, [{ address: "a", share: 1 }])).toEqual([]);
    expect(airdropDistribution(5, [])).toEqual([]);
  });
});

describe("canPayBounty", () => {
  const claimed: Bounty = { id: "b1", rewardSol: 2, status: "claimed" };

  it("approves a claimed, verified, in-budget bounty", () => {
    expect(canPayBounty({ bounty: claimed, treasurySol: 10, verified: true }).ok).toBe(true);
  });
  it("refuses unverified work (ties to the verifier gate)", () => {
    const r = canPayBounty({ bounty: claimed, treasurySol: 10, verified: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not verified/);
  });
  it("refuses a bounty that isn't claimed", () => {
    for (const status of ["open", "paid", "cancelled"] as const) {
      expect(canPayBounty({ bounty: { ...claimed, status }, treasurySol: 10, verified: true }).ok).toBe(false);
    }
  });
  it("refuses a reward over the treasury balance", () => {
    const r = canPayBounty({ bounty: { ...claimed, rewardSol: 50 }, treasurySol: 10, verified: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exceeds/);
  });
  it("refuses a non-positive reward", () => {
    expect(canPayBounty({ bounty: { ...claimed, rewardSol: 0 }, treasurySol: 10, verified: true }).ok).toBe(false);
  });
});
