import { describe, it, expect, afterEach } from "vitest";
import {
  loopMint,
  stakeEnforced,
  meetsStake,
  sumLoopBalance,
  hasRequiredStake,
  STAKE_REQUIRED_LOOP,
} from "./stake";

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
});

const VALID_MINT = "Dcsvk7UP8iYkrhRvp9auC3LPdTYY2XgP1VcxgzJ397Vb";

describe("loopMint / stakeEnforced", () => {
  it("is off (null) when LOOP_MINT is unset", () => {
    delete process.env.LOOP_MINT;
    expect(loopMint()).toBeNull();
    expect(stakeEnforced()).toBe(false);
  });
  it("ignores a malformed mint", () => {
    process.env.LOOP_MINT = "not-a-pubkey";
    expect(loopMint()).toBeNull();
    expect(stakeEnforced()).toBe(false);
  });
  it("is on with a valid base58 mint", () => {
    process.env.LOOP_MINT = VALID_MINT;
    expect(loopMint()).toBe(VALID_MINT);
    expect(stakeEnforced()).toBe(true);
  });
});

describe("meetsStake", () => {
  it("requires >= the threshold", () => {
    expect(meetsStake(STAKE_REQUIRED_LOOP)).toBe(true);
    expect(meetsStake(STAKE_REQUIRED_LOOP + 1)).toBe(true);
    expect(meetsStake(STAKE_REQUIRED_LOOP - 1)).toBe(false);
    expect(meetsStake(0)).toBe(false);
    expect(meetsStake(null)).toBe(false);
  });
});

describe("sumLoopBalance", () => {
  it("sums uiAmount across token accounts", () => {
    const rpc = {
      value: [
        { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 600 } } } } } },
        { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 500 } } } } } },
      ],
    };
    expect(sumLoopBalance(rpc)).toBe(1100);
  });
  it("handles empty / malformed results", () => {
    expect(sumLoopBalance({ value: [] })).toBe(0);
    expect(sumLoopBalance({})).toBe(0);
    expect(sumLoopBalance(null)).toBe(0);
  });
});

describe("hasRequiredStake", () => {
  it("is open when stake isn't enforced", async () => {
    delete process.env.LOOP_MINT;
    expect(await hasRequiredStake(null, "devnet")).toBe(true);
  });
  it("rejects a missing owner when enforced", async () => {
    process.env.LOOP_MINT = VALID_MINT;
    expect(await hasRequiredStake(null, "devnet")).toBe(false);
  });
});
