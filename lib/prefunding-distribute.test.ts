import { describe, it, expect } from "vitest";
import { splitTokensByContribution, groupContributionsByWallet } from "./prefunding-distribute";

const A = "DrUJpyCnAwJ7JTCjqNoxjyEaXMMcSVQLZ2bzGntt8xeT";
const B = "HCpXujcA9mdBN3fES2DjYbf6AjNwk9bNDpG2dFb1ePAe";
const C = "BXdPPqDwYBGxAqSJyC1kZKtjXo3agAtP2Sfk1L2r1rXp";

describe("groupContributionsByWallet", () => {
  it("sums multiple confirmed deposits from the same backer", () => {
    const g = groupContributionsByWallet([
      { contributorWallet: A, amountSol: 0.01, status: "confirmed" },
      { contributorWallet: A, amountSol: 0.02, status: "confirmed" },
      { contributorWallet: B, amountSol: 0.05, status: "confirmed" },
    ]);
    expect(g).toEqual(
      expect.arrayContaining([
        { wallet: A, sol: 0.03 },
        { wallet: B, sol: 0.05 },
      ]),
    );
  });

  it("excludes non-confirmed (refunded/distributed) rows and dust", () => {
    const g = groupContributionsByWallet([
      { contributorWallet: A, amountSol: 0.05, status: "refunded" },
      { contributorWallet: B, amountSol: 0.05, status: "distributed" },
      { contributorWallet: C, amountSol: 0.0001, status: "confirmed" },
    ]);
    expect(g).toEqual([]);
  });
});

describe("splitTokensByContribution", () => {
  it("splits proportionally and the parts re-sum EXACTLY to tokensBought", () => {
    const shares = splitTokensByContribution(
      [
        { wallet: A, sol: 0.03 },
        { wallet: B, sol: 0.01 },
      ],
      BigInt(1_000_000),
    );
    const total = shares.reduce((s, x) => s + x.tokens, BigInt(0));
    expect(total).toBe(BigInt(1_000_000));
    // A contributed 3x what B did.
    const a = shares.find((s) => s.wallet === A)!;
    const b = shares.find((s) => s.wallet === B)!;
    expect(a.tokens).toBeGreaterThan(b.tokens * BigInt(2));
  });

  it("gives 100% to the sole backer", () => {
    const shares = splitTokensByContribution([{ wallet: A, sol: 0.5 }], BigInt(9_999));
    expect(shares).toEqual([{ wallet: A, sol: 0.5, tokens: BigInt(9_999) }]);
  });

  it("dumps the integer-division remainder on the largest contributor, never invents or drops units", () => {
    // 3 equal contributors splitting an amount that doesn't divide evenly by 3.
    const shares = splitTokensByContribution(
      [
        { wallet: A, sol: 0.01 },
        { wallet: B, sol: 0.01 },
        { wallet: C, sol: 0.02 }, // largest — should absorb the remainder
      ],
      BigInt(100),
    );
    const total = shares.reduce((s, x) => s + x.tokens, BigInt(0));
    expect(total).toBe(BigInt(100));
    const c = shares.find((s) => s.wallet === C)!;
    const a = shares.find((s) => s.wallet === A)!;
    expect(c.tokens).toBeGreaterThan(a.tokens);
  });

  it("returns all-zero shares for an empty or non-positive input", () => {
    expect(splitTokensByContribution([], BigInt(1000))).toEqual([]);
    expect(splitTokensByContribution([{ wallet: A, sol: 1 }], BigInt(0))).toEqual([{ wallet: A, sol: 1, tokens: BigInt(0) }]);
  });
});
