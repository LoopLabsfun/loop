import { describe, it, expect } from "vitest";
import { computeRewardRateLoopUnits } from "./compute-rewards-exec";

describe("computeRewardRateLoopUnits", () => {
  it("defaults to 0 (disarmed) when unset", () => {
    expect(computeRewardRateLoopUnits({})).toBe(0);
  });
  it("ignores non-numeric / non-positive values", () => {
    expect(computeRewardRateLoopUnits({ COMPUTE_REWARD_LOOP_UNITS_PER_UNIT: "nope" })).toBe(0);
    expect(computeRewardRateLoopUnits({ COMPUTE_REWARD_LOOP_UNITS_PER_UNIT: "0" })).toBe(0);
    expect(computeRewardRateLoopUnits({ COMPUTE_REWARD_LOOP_UNITS_PER_UNIT: "-5" })).toBe(0);
  });
  it("accepts and rounds a configured positive rate", () => {
    expect(computeRewardRateLoopUnits({ COMPUTE_REWARD_LOOP_UNITS_PER_UNIT: "1000" })).toBe(1000);
    expect(computeRewardRateLoopUnits({ COMPUTE_REWARD_LOOP_UNITS_PER_UNIT: "1000.7" })).toBe(1001);
  });
});
