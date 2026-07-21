import { describe, expect, it } from "vitest";

import {
  ethEnvToWei,
  hoodOpsConfig,
  planHoodBuyback,
  planHoodSweep,
} from "./hood-ops";

const ETHER = BigInt("1000000000000000000");
const LAUNCHER = "0x52908400098527886E0F7030069857D2E4169EE7";
const TOKEN = "0x8617E340B3D01FA5F11F306F4090FD50E238070D";

describe("ethEnvToWei", () => {
  it("parses decimal ETH into wei", () => {
    expect(ethEnvToWei("1")).toBe(ETHER);
    expect(ethEnvToWei("0.005")).toBe(ETHER / BigInt(200));
    expect(ethEnvToWei("0.0005")).toBe(ETHER / BigInt(2000));
  });

  it("returns 0 on unset/junk/negative", () => {
    expect(ethEnvToWei(undefined)).toBe(BigInt(0));
    expect(ethEnvToWei("")).toBe(BigInt(0));
    expect(ethEnvToWei("nope")).toBe(BigInt(0));
    expect(ethEnvToWei("-1")).toBe(BigInt(0));
  });
});

describe("hoodOpsConfig", () => {
  it("is disarmed with safe defaults on an empty env", () => {
    const cfg = hoodOpsConfig({});
    expect(cfg.armed).toBe(false);
    expect(cfg.sweepWalletId).toBeNull();
    expect(cfg.buybackWalletId).toBeNull();
    expect(cfg.buybackSpendWei).toBe(BigInt(0)); // buyback disabled
    expect(cfg.sweepMinWei).toBe(ethEnvToWei("0.005"));
    expect(cfg.gasReserveWei).toBe(ethEnvToWei("0.0005"));
    expect(cfg.buybackSlippageBps).toBe(500);
  });

  it("reads the full env", () => {
    const cfg = hoodOpsConfig({
      HOOD_OPS_ARMED: "1",
      HOOD_SWEEP_WALLET_ID: "w-sweep",
      HOOD_SWEEP_MIN_ETH: "0.01",
      HOOD_BUYBACK_WALLET_ID: "w-agent",
      HOOD_BUYBACK_WALLET_ADDRESS: TOKEN,
      HOOD_BUYBACK_ETH: "0.02",
      HOOD_BUYBACK_SLIPPAGE_BPS: "300",
    });
    expect(cfg.armed).toBe(true);
    expect(cfg.sweepWalletId).toBe("w-sweep");
    expect(cfg.sweepMinWei).toBe(ethEnvToWei("0.01"));
    expect(cfg.buybackWalletAddress).toBe(TOKEN);
    expect(cfg.buybackSpendWei).toBe(ethEnvToWei("0.02"));
    expect(cfg.buybackSlippageBps).toBe(300);
  });

  it("rejects a malformed buyback wallet address", () => {
    const cfg = hoodOpsConfig({ HOOD_BUYBACK_WALLET_ADDRESS: "not-an-address" });
    expect(cfg.buybackWalletAddress).toBeNull();
  });
});

describe("planHoodSweep", () => {
  const base = {
    minWei: ethEnvToWei("0.005"),
    walletId: "w-sweep",
    launcher: LAUNCHER,
  };

  it("sweeps when pending clears the floor and a wallet is configured", () => {
    const p = planHoodSweep({ ...base, pendingWei: ETHER });
    expect(p.send).toBe(true);
  });

  it("skips below the floor", () => {
    const p = planHoodSweep({ ...base, pendingWei: BigInt(1) });
    expect(p.send).toBe(false);
    expect(p.reason).toContain("below sweep floor");
  });

  it("reports (not sends) when no sweep wallet — founder sweeps manually", () => {
    const p = planHoodSweep({ ...base, walletId: null, pendingWei: ETHER });
    expect(p.send).toBe(false);
    expect(p.reason).toContain("founder sweeps manually");
  });

  it("skips when the launcher is unset or the read failed", () => {
    expect(planHoodSweep({ ...base, launcher: null, pendingWei: ETHER }).send).toBe(false);
    expect(planHoodSweep({ ...base, pendingWei: null }).send).toBe(false);
  });
});

describe("planHoodBuyback", () => {
  const base = {
    balanceWei: ETHER, // 1 ETH in the wallet
    spendWei: ethEnvToWei("0.02"),
    gasReserveWei: ethEnvToWei("0.0005"),
    quotedTokensOut: BigInt(1_000_000) * ETHER,
    slippageBps: 500,
    launcher: LAUNCHER,
    token: TOKEN,
    walletId: "w-agent",
  };

  it("buys the configured size with a slippage floor", () => {
    const p = planHoodBuyback(base);
    expect(p.send).toBe(true);
    expect(p.valueWei).toBe(base.spendWei);
    // floor = quote × (1 − 5%)
    expect(p.minTokensOut).toBe((base.quotedTokensOut * BigInt(9500)) / BigInt(10_000));
  });

  it("clamps spend to balance minus the gas reserve", () => {
    const thin = ethEnvToWei("0.01"); // wallet has less than the 0.02 target
    const p = planHoodBuyback({ ...base, balanceWei: thin });
    expect(p.send).toBe(true);
    expect(p.valueWei).toBe(thin - base.gasReserveWei);
  });

  it("skips when the balance is under the gas reserve", () => {
    const p = planHoodBuyback({ ...base, balanceWei: BigInt(1) });
    expect(p.send).toBe(false);
    expect(p.reason).toContain("gas reserve");
  });

  it("is disabled at spend 0 and without config", () => {
    expect(planHoodBuyback({ ...base, spendWei: BigInt(0) }).send).toBe(false);
    expect(planHoodBuyback({ ...base, walletId: null }).send).toBe(false);
    expect(planHoodBuyback({ ...base, token: null }).send).toBe(false);
    expect(planHoodBuyback({ ...base, launcher: null }).send).toBe(false);
  });

  it("refuses to buy without a live quote", () => {
    const p = planHoodBuyback({ ...base, quotedTokensOut: null });
    expect(p.send).toBe(false);
    expect(p.reason).toContain("quoteBuy failed");
  });
});
