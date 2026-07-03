import { describe, it, expect } from "vitest";
import {
  MIN_CONTRIBUTION_SOL,
  isMeaningfulContribution,
  totalRaised,
  backerCount,
  planRefunds,
  refundSendableLamports,
  REFUND_FEE_RESERVE_LAMPORTS,
  type Contribution,
} from "./prefunding";

const c = (contributorWallet: string, amountSol: number, txSig: string, status = "confirmed"): Contribution => ({
  contributorWallet,
  amountSol,
  txSig,
  status,
});

describe("isMeaningfulContribution", () => {
  it("accepts amounts at/above the dust floor", () => {
    expect(isMeaningfulContribution(MIN_CONTRIBUTION_SOL)).toBe(true);
    expect(isMeaningfulContribution(1)).toBe(true);
  });
  it("rejects dust, zero, negatives, and non-numbers", () => {
    expect(isMeaningfulContribution(MIN_CONTRIBUTION_SOL / 2)).toBe(false);
    expect(isMeaningfulContribution(0)).toBe(false);
    expect(isMeaningfulContribution(-1)).toBe(false);
    expect(isMeaningfulContribution("1" as unknown)).toBe(false);
    expect(isMeaningfulContribution(NaN)).toBe(false);
  });
});

describe("totalRaised", () => {
  it("sums only confirmed contributions", () => {
    const cs = [c("A", 1, "s1"), c("B", 0.5, "s2"), c("C", 2, "s3", "refunded")];
    expect(totalRaised(cs)).toBe(1.5);
  });
  it("is 0 for an empty / all-refunded ledger", () => {
    expect(totalRaised([])).toBe(0);
    expect(totalRaised([c("A", 1, "s1", "refunded")])).toBe(0);
  });
  it("avoids float drift (lamport rounding)", () => {
    expect(totalRaised([c("A", 0.1, "s1"), c("A", 0.2, "s2")])).toBe(0.3);
  });
});

describe("backerCount", () => {
  it("counts distinct confirmed backers", () => {
    const cs = [c("A", 1, "s1"), c("A", 1, "s2"), c("B", 1, "s3"), c("C", 1, "s4", "refunded")];
    expect(backerCount(cs)).toBe(2);
  });
});

describe("planRefunds", () => {
  it("groups confirmed contributions per backer into one transfer each", () => {
    const cs = [c("A", 1, "s1"), c("A", 0.5, "s2"), c("B", 2, "s3")];
    const plan = planRefunds(cs);
    expect(plan).toContainEqual({ to: "A", sol: 1.5 });
    expect(plan).toContainEqual({ to: "B", sol: 2 });
    expect(plan).toHaveLength(2);
  });
  it("skips already-refunded entries and dust totals", () => {
    const cs = [
      c("A", 1, "s1", "refunded"),
      c("B", MIN_CONTRIBUTION_SOL / 3, "s2"),
      c("C", 3, "s3"),
    ];
    const plan = planRefunds(cs);
    expect(plan).toEqual([{ to: "C", sol: 3 }]);
  });
  it("is empty for an empty ledger", () => {
    expect(planRefunds([])).toEqual([]);
  });
});

describe("refundSendableLamports", () => {
  const R = REFUND_FEE_RESERVE_LAMPORTS;
  it("sends the full amount when the wallet has fee headroom", () => {
    expect(refundSendableLamports(6_000_000, 6_000_000 + R + 1)).toBe(6_000_000);
  });
  it("caps to (balance - fee) when the wallet holds exactly the owed amount (the real bug)", () => {
    // memeforge: wallet = 0.006 SOL, owed = 0.006 SOL → send 0.006 - fee, never fail
    expect(refundSendableLamports(6_000_000, 6_000_000)).toBe(6_000_000 - R);
  });
  it("returns 0 (skip) when the balance can't even cover the fee", () => {
    expect(refundSendableLamports(6_000_000, R)).toBe(0);
    expect(refundSendableLamports(6_000_000, 0)).toBe(0);
  });
  it("falls back to the full owed amount when the balance is unknown (null)", () => {
    expect(refundSendableLamports(6_000_000, null)).toBe(6_000_000);
  });
  it("rounds owed and floors the balance to whole lamports", () => {
    expect(refundSendableLamports(1_000.6, null)).toBe(1_001);
    expect(refundSendableLamports(1_000_000, 5_000_000.9, 0)).toBe(1_000_000);
  });
});
