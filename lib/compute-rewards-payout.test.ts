import { describe, it, expect } from "vitest";
import { computeRewardsPayArmed } from "./compute-rewards-payout";

describe("computeRewardsPayArmed", () => {
  it("is armed ONLY by an explicit COMPUTE_REWARDS_PAY=1 (default disarmed)", () => {
    expect(computeRewardsPayArmed({})).toBe(false);
    expect(computeRewardsPayArmed({ COMPUTE_REWARDS_PAY: "0" })).toBe(false);
    expect(computeRewardsPayArmed({ COMPUTE_REWARDS_PAY: "" })).toBe(false);
    expect(computeRewardsPayArmed({ COMPUTE_REWARDS_PAY: "true" })).toBe(false);
    expect(computeRewardsPayArmed({ COMPUTE_REWARDS_PAY: "1" })).toBe(true);
  });
});
