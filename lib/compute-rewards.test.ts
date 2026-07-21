import { describe, expect, it } from "vitest";
import { claimableLoopUnits, planAccrual } from "./compute-rewards";

describe("claimableLoopUnits", () => {
  it("earned minus claimed", () => {
    expect(claimableLoopUnits({ earnedLoopUnits: 100, claimedLoopUnits: 40 })).toBe(60);
  });
  it("clamps at zero (never negative)", () => {
    expect(claimableLoopUnits({ earnedLoopUnits: 10, claimedLoopUnits: 40 })).toBe(0);
  });
  it("zero balance is zero", () => {
    expect(claimableLoopUnits({ earnedLoopUnits: 0, claimedLoopUnits: 0 })).toBe(0);
  });
});

describe("planAccrual", () => {
  const unit = (deviceId: string, addr: string | null = null, hood: string | null = null) => ({
    deviceId,
    payoutAddress: addr,
    payoutAddressHood: hood,
  });

  it("rate ≤ 0 means disarmed — no accrual at all", () => {
    expect(planAccrual([unit("a", "wa")], 0)).toEqual([]);
    expect(planAccrual([unit("a", "wa")], -5)).toEqual([]);
  });

  it("credits one unit at the configured rate", () => {
    const plan = planAccrual([unit("a", "wa")], 1000);
    expect(plan).toEqual([{ deviceId: "a", payoutAddress: "wa", payoutAddressHood: null, addLoopUnits: 1000 }]);
  });

  it("sums multiple units for the same device", () => {
    const plan = planAccrual([unit("a", "wa"), unit("a", "wa"), unit("a", "wa")], 1000);
    expect(plan).toEqual([{ deviceId: "a", payoutAddress: "wa", payoutAddressHood: null, addLoopUnits: 3000 }]);
  });

  it("keeps devices separate", () => {
    const plan = planAccrual([unit("a", "wa"), unit("b", "wb")], 500);
    expect(plan.sort((x, y) => x.deviceId.localeCompare(y.deviceId))).toEqual([
      { deviceId: "a", payoutAddress: "wa", payoutAddressHood: null, addLoopUnits: 500 },
      { deviceId: "b", payoutAddress: "wb", payoutAddressHood: null, addLoopUnits: 500 },
    ]);
  });

  it("a later unit's non-null payout address overrides an earlier one", () => {
    const plan = planAccrual([unit("a", "old-wallet"), unit("a", "new-wallet")], 100);
    expect(plan[0].payoutAddress).toBe("new-wallet");
  });

  it("a null payout address never erases a previously-seen one", () => {
    const plan = planAccrual([unit("a", "wa"), unit("a", null)], 100);
    expect(plan[0].payoutAddress).toBe("wa");
  });

  it("tracks the Hood address independently of the Solana one", () => {
    const plan = planAccrual([unit("a", "wa", null), unit("a", null, "0xhood")], 100);
    expect(plan[0]).toMatchObject({ payoutAddress: "wa", payoutAddressHood: "0xhood" });
  });
});
