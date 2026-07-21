import { describe, it, expect } from "vitest";
import { computeRewardRateLamports } from "./compute-rewards-exec";

describe("computeRewardRateLamports", () => {
  it("defaults to 0 (disarmed) when unset", () => {
    expect(computeRewardRateLamports({})).toBe(0);
  });
  it("ignores non-numeric / non-positive values", () => {
    expect(computeRewardRateLamports({ COMPUTE_REWARD_LAMPORTS_PER_UNIT: "nope" })).toBe(0);
    expect(computeRewardRateLamports({ COMPUTE_REWARD_LAMPORTS_PER_UNIT: "0" })).toBe(0);
    expect(computeRewardRateLamports({ COMPUTE_REWARD_LAMPORTS_PER_UNIT: "-5" })).toBe(0);
  });
  it("accepts and rounds a configured positive rate", () => {
    expect(computeRewardRateLamports({ COMPUTE_REWARD_LAMPORTS_PER_UNIT: "1000" })).toBe(1000);
    expect(computeRewardRateLamports({ COMPUTE_REWARD_LAMPORTS_PER_UNIT: "1000.7" })).toBe(1001);
  });
});
