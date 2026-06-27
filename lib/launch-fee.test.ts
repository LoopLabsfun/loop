import { describe, it, expect } from "vitest";
import { launchFeeLamports, launchFeeWallet, launchFeeRequired } from "./launch-fee";
import { lamportsCredited } from "./solana";

const WALLET = "H8UMZSW2nZQm59G56UGmKAKVcgf5rcgEdFbVvcA9TSvC";

describe("launchFeeLamports", () => {
  it("is 0 when unset, blank, zero, negative, or non-numeric", () => {
    for (const v of [undefined, "", "0", "-1", "abc", "NaN"]) {
      expect(launchFeeLamports({ LAUNCH_FEE_SOL: v })).toBe(BigInt(0));
    }
  });
  it("converts SOL to lamports", () => {
    expect(launchFeeLamports({ LAUNCH_FEE_SOL: "1" })).toBe(BigInt(1_000_000_000));
    expect(launchFeeLamports({ LAUNCH_FEE_SOL: "0.5" })).toBe(BigInt(500_000_000));
    expect(launchFeeLamports({ LAUNCH_FEE_SOL: "0.05" })).toBe(BigInt(50_000_000));
  });
});

describe("launchFeeWallet", () => {
  it("is null when unset or malformed", () => {
    for (const v of [undefined, "", "  ", "not-a-wallet", "0OIl"]) {
      expect(launchFeeWallet({ LAUNCH_FEE_WALLET: v })).toBeNull();
    }
  });
  it("returns a valid base58 wallet (trimmed)", () => {
    expect(launchFeeWallet({ LAUNCH_FEE_WALLET: WALLET })).toBe(WALLET);
    expect(launchFeeWallet({ LAUNCH_FEE_WALLET: `  ${WALLET}  ` })).toBe(WALLET);
  });
});

describe("launchFeeRequired", () => {
  it("needs BOTH a positive fee and a valid collector wallet", () => {
    expect(launchFeeRequired({})).toBe(false);
    expect(launchFeeRequired({ LAUNCH_FEE_SOL: "0.1" })).toBe(false); // no wallet
    expect(launchFeeRequired({ LAUNCH_FEE_WALLET: WALLET })).toBe(false); // no fee
    expect(launchFeeRequired({ LAUNCH_FEE_SOL: "0", LAUNCH_FEE_WALLET: WALLET })).toBe(false);
    expect(launchFeeRequired({ LAUNCH_FEE_SOL: "0.1", LAUNCH_FEE_WALLET: WALLET })).toBe(true);
  });
});

describe("lamportsCredited", () => {
  const keys = [{ pubkey: "AAA" }, { pubkey: WALLET }, { pubkey: "CCC" }];

  it("returns the positive native-balance delta credited to `to`", () => {
    const pre = [10, 100, 5];
    const post = [9, 100 + 50_000_000, 5];
    expect(lamportsCredited(keys, pre, post, WALLET)).toBe(BigInt(50_000_000));
  });

  it("is 0 when the account didn't gain (or lost) balance", () => {
    expect(lamportsCredited(keys, [0, 100, 0], [0, 100, 0], WALLET)).toBe(BigInt(0));
    expect(lamportsCredited(keys, [0, 100, 0], [0, 40, 0], WALLET)).toBe(BigInt(0));
  });

  it("is 0 when `to` isn't in the account list", () => {
    expect(lamportsCredited(keys, [0, 0, 0], [0, 9, 0], "ZZZ")).toBe(BigInt(0));
  });

  it("is 0 on missing/short balance arrays", () => {
    expect(lamportsCredited(keys, undefined, undefined, WALLET)).toBe(BigInt(0));
    expect(lamportsCredited(undefined, [1], [2], WALLET)).toBe(BigInt(0));
    expect(lamportsCredited(keys, [0], [0], WALLET)).toBe(BigInt(0)); // index 1 out of range
  });
});
