import { describe, it, expect } from "vitest";
import { feeDistributeArmed } from "./fee-distribute-exec";

describe("feeDistributeArmed", () => {
  it("is armed ONLY by an explicit FEE_DISTRIBUTE=1 (default disarmed)", () => {
    expect(feeDistributeArmed({})).toBe(false);
    expect(feeDistributeArmed({ FEE_DISTRIBUTE: "0" })).toBe(false);
    expect(feeDistributeArmed({ FEE_DISTRIBUTE: "" })).toBe(false);
    expect(feeDistributeArmed({ FEE_DISTRIBUTE: "true" })).toBe(false);
    expect(feeDistributeArmed({ FEE_DISTRIBUTE: "1" })).toBe(true);
  });
});
