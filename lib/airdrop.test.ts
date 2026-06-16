import { describe, it, expect } from "vitest";
import { computeAirdrop, type Holder } from "./airdrop";

const sum = (a: { amount: number }[]) => a.reduce((s, x) => s + x.amount, 0);

describe("computeAirdrop", () => {
  it("returns empty for no holders or a non-positive pool", () => {
    expect(computeAirdrop([], 100).allocations).toEqual([]);
    expect(computeAirdrop([{ address: "a", balance: 10 }], 0).allocations).toEqual([]);
    expect(computeAirdrop([{ address: "a", balance: 10 }], -5).allocations).toEqual([]);
  });

  it("distributes the full pool (re-sums exactly, no dust)", () => {
    const holders: Holder[] = [
      { address: "a", balance: 1000 },
      { address: "b", balance: 250 },
      { address: "c", balance: 1 },
    ];
    const plan = computeAirdrop(holders, 10);
    expect(sum(plan.allocations)).toBeCloseTo(10, 9);
    expect(plan.distributed).toBeCloseTo(10, 9);
  });

  it("sqrt weighting dampens whales vs linear (the fairness property)", () => {
    const holders: Holder[] = [
      { address: "whale", balance: 10_000 },
      { address: "small", balance: 100 }, // 100x less
    ];
    const sqrt = computeAirdrop(holders, 100, { weighting: "sqrt" });
    const linear = computeAirdrop(holders, 100, { weighting: "linear" });
    const whaleSqrt = sqrt.allocations.find((a) => a.address === "whale")!.amount;
    const whaleLinear = linear.allocations.find((a) => a.address === "whale")!.amount;
    // Linear gives the whale ~99%; sqrt gives ~91% — strictly less, small holder gets more.
    expect(whaleSqrt).toBeLessThan(whaleLinear);
    const smallSqrt = sqrt.allocations.find((a) => a.address === "small")!.amount;
    const smallLinear = linear.allocations.find((a) => a.address === "small")!.amount;
    expect(smallSqrt).toBeGreaterThan(smallLinear);
  });

  it("equal weighting pays every eligible holder the same", () => {
    const plan = computeAirdrop(
      [
        { address: "a", balance: 10_000 },
        { address: "b", balance: 10 },
      ],
      8,
      { weighting: "equal" }
    );
    expect(plan.allocations.every((a) => a.amount === 4)).toBe(true);
  });

  it("applies the anti-sybil floor and the exclude list", () => {
    const holders: Holder[] = [
      { address: "treasury", balance: 1_000_000 },
      { address: "ok", balance: 500 },
      { address: "dust", balance: 1 },
    ];
    const plan = computeAirdrop(holders, 10, {
      minBalance: 100,
      exclude: ["treasury"],
    });
    expect(plan.recipients).toBe(1);
    expect(plan.allocations[0].address).toBe("ok");
    expect(plan.allocations[0].amount).toBeCloseTo(10, 9);
  });

  it("reports topShare (whale-capture metric)", () => {
    const plan = computeAirdrop(
      [
        { address: "a", balance: 100 },
        { address: "b", balance: 100 },
      ],
      10
    );
    expect(plan.topShare).toBeCloseTo(0.5, 6);
  });
});
