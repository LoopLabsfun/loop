import { afterEach, describe, expect, it } from "vitest";

import {
  MIN_TRANSFER_WEI,
  executeHoodFeeDistribution,
  hoodPlatformWallet,
  planHoodFeeDistribution,
  splitFeesWei,
} from "./hood-fee-distribute";

const FOUNDER = "0x52908400098527886E0F7030069857D2E4169EE7";
const AGENT = "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
const PLATFORM = "0xde709f2102306220921060314715629080e2fb77";
const ETHER = BigInt("1000000000000000000");

describe("splitFeesWei", () => {
  it("splits with platform fixed at 5% and founder as launched", () => {
    // founder 30 → agent 65, platform 5
    const s = splitFeesWei(ETHER, 30);
    expect(s.founderWei).toBe((ETHER * BigInt(30)) / BigInt(100));
    expect(s.agentWei).toBe((ETHER * BigInt(65)) / BigInt(100));
    // platform absorbs the remainder → the three sum to exactly total
    expect(s.founderWei + s.agentWei + s.platformWei).toBe(ETHER);
    expect(s.platformWei).toBe(ETHER - s.founderWei - s.agentWei);
  });

  it("never over-distributes on a non-divisible total", () => {
    const odd = BigInt(1_000_000_007);
    const s = splitFeesWei(odd, 33);
    expect(s.founderWei + s.agentWei + s.platformWei).toBe(odd);
  });
});

describe("planHoodFeeDistribution", () => {
  it("plans founder + agent + platform legs above the dust floor", () => {
    const plan = planHoodFeeDistribution({
      claimableFounderWei: ETHER,
      claimableAgentWei: ETHER * BigInt(2),
      claimablePlatformWei: ETHER,
      founderWallet: FOUNDER,
      agentWallet: AGENT,
      platformWallet: PLATFORM,
    });
    expect(plan.transfers.map((t) => t.role)).toEqual(["founder", "agent", "platform"]);
    expect(plan.totalWei).toBe(ETHER * BigInt(4));
  });

  it("skips dust, missing wallets, and the source-wallet leg", () => {
    const plan = planHoodFeeDistribution({
      claimableFounderWei: BigInt(1), // dust
      claimableAgentWei: ETHER,
      claimablePlatformWei: ETHER,
      founderWallet: FOUNDER,
      agentWallet: null, // missing
      platformWallet: PLATFORM,
      sourceWallet: PLATFORM, // platform share is already where it belongs
    });
    expect(plan.transfers).toHaveLength(0);
    expect(plan.skipped).toHaveLength(3);
    expect(plan.skipped.some((s) => /dust/.test(s))).toBe(true);
    expect(plan.skipped.some((s) => /no valid wallet/.test(s))).toBe(true);
    expect(plan.skipped.some((s) => /source wallet/.test(s))).toBe(true);
  });

  it("rejects a malformed EVM address", () => {
    const plan = planHoodFeeDistribution({
      claimableAgentWei: ETHER,
      claimablePlatformWei: BigInt(0),
      agentWallet: "0x123",
    });
    expect(plan.transfers).toHaveLength(0);
    expect(plan.skipped[0]).toMatch(/no valid wallet/);
  });

  it("uses the exported dust floor by default", () => {
    const plan = planHoodFeeDistribution({
      claimableAgentWei: MIN_TRANSFER_WEI - BigInt(1),
      claimablePlatformWei: BigInt(0),
      agentWallet: AGENT,
    });
    expect(plan.transfers).toHaveLength(0);
  });
});

describe("hoodPlatformWallet", () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIG };
  });
  it("reads a valid EVM address, else null", () => {
    process.env.HOOD_PLATFORM_WALLET = PLATFORM;
    expect(hoodPlatformWallet()).toBe(PLATFORM);
    process.env.HOOD_PLATFORM_WALLET = "not-an-address";
    expect(hoodPlatformWallet()).toBeNull();
    delete process.env.HOOD_PLATFORM_WALLET;
    expect(hoodPlatformWallet()).toBeNull();
  });
});

describe("executeHoodFeeDistribution", () => {
  it("is a dry run unless armed (no ETH moves)", async () => {
    const plan = planHoodFeeDistribution({
      claimableAgentWei: ETHER,
      claimablePlatformWei: BigInt(0),
      agentWallet: AGENT,
    });
    const r = await executeHoodFeeDistribution("wallet-id", plan);
    expect(r.ok).toBe(true);
    expect(r.sent).toHaveLength(0);
    expect(r.note).toMatch(/dry run/);
  });

  it("returns cleanly when there's nothing to distribute", async () => {
    const r = await executeHoodFeeDistribution("wallet-id", {
      transfers: [],
      totalWei: BigInt(0),
      skipped: [],
    });
    expect(r.ok).toBe(true);
    expect(r.note).toMatch(/nothing/);
  });
});
