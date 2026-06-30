import { describe, it, expect } from "vitest";
import { planFeeDistribution, MIN_TRANSFER_SOL } from "./fee-distribute";

const AGENT = "5Fk6yGjCWsUYB2NAA4uo8WaqXh6WGZoxxaz85PYJXwRV";
const PLATFORM = "7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9";

describe("planFeeDistribution", () => {
  it("builds agent + platform transfers from claimable balances", () => {
    const plan = planFeeDistribution({
      claimableAgentSol: 0.65,
      claimablePlatformSol: 0.05,
      agentWallet: AGENT,
      platformWallet: PLATFORM,
    });
    expect(plan.transfers).toEqual([
      { role: "agent", to: AGENT, sol: 0.65 },
      { role: "platform", to: PLATFORM, sol: 0.05 },
    ]);
    expect(plan.totalSol).toBeCloseTo(0.7, 9);
    expect(plan.skipped).toHaveLength(0);
  });

  it("never includes the founder share (it stays in the custodial wallet)", () => {
    const plan = planFeeDistribution({
      claimableAgentSol: 0.65,
      claimablePlatformSol: 0.05,
      agentWallet: AGENT,
      platformWallet: PLATFORM,
    });
    expect(plan.transfers.some((t) => (t.role as string) === "founder")).toBe(false);
  });

  it("skips a share below the dust floor", () => {
    const plan = planFeeDistribution({
      claimableAgentSol: MIN_TRANSFER_SOL / 2,
      claimablePlatformSol: 0.05,
      agentWallet: AGENT,
      platformWallet: PLATFORM,
    });
    expect(plan.transfers).toHaveLength(1);
    expect(plan.transfers[0].role).toBe("platform");
    expect(plan.skipped.join(" ")).toMatch(/agent.*dust/);
  });

  it("skips a share with no valid wallet but reports it", () => {
    const plan = planFeeDistribution({
      claimableAgentSol: 0.65,
      claimablePlatformSol: 0.05,
      agentWallet: AGENT,
      platformWallet: null,
    });
    expect(plan.transfers).toHaveLength(1);
    expect(plan.transfers[0].role).toBe("agent");
    expect(plan.skipped.join(" ")).toMatch(/platform: no valid wallet/);
  });

  it("rejects a malformed wallet address", () => {
    const plan = planFeeDistribution({
      claimableAgentSol: 0.65,
      claimablePlatformSol: 0,
      agentWallet: "not-a-real-base58-address!!",
      platformWallet: PLATFORM,
    });
    expect(plan.transfers).toHaveLength(0);
    expect(plan.skipped.join(" ")).toMatch(/agent: no valid wallet/);
  });

  it("treats negative/zero claimable as nothing to send", () => {
    const plan = planFeeDistribution({
      claimableAgentSol: -1,
      claimablePlatformSol: 0,
      agentWallet: AGENT,
      platformWallet: PLATFORM,
    });
    expect(plan.transfers).toHaveLength(0);
    expect(plan.totalSol).toBe(0);
  });

  // ── shared-signer projects: founder leg + source-aware skip ────────────────
  const FOUNDER = "EjY8st6VyzRdKVLDfc4J5C3dQ6wNjzr6rAtkYMXuR7Kz";
  const SOURCE = "7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9"; // shared launch signer
  const PLATFORM_SINK = "So11111111111111111111111111111111111111112";

  it("transfers the founder share when its wallet differs from the source", () => {
    const plan = planFeeDistribution({
      claimableFounderSol: 0.3,
      claimableAgentSol: 0.65,
      claimablePlatformSol: 0.05,
      founderWallet: FOUNDER,
      agentWallet: AGENT,
      platformWallet: PLATFORM_SINK,
      sourceWallet: SOURCE,
    });
    expect(plan.transfers.map((t) => t.role)).toEqual(["founder", "agent", "platform"]);
    expect(plan.transfers[0]).toEqual({ role: "founder", to: FOUNDER, sol: 0.3 });
  });

  it("leaves a share in place when its destination IS the source wallet (LOOP founder)", () => {
    const plan = planFeeDistribution({
      claimableFounderSol: 0.3,
      claimableAgentSol: 0.65,
      claimablePlatformSol: 0.05,
      founderWallet: SOURCE, // LOOP: founder == creator == fee source
      agentWallet: AGENT,
      platformWallet: PLATFORM_SINK,
      sourceWallet: SOURCE,
    });
    expect(plan.transfers.some((t) => t.role === "founder")).toBe(false);
    expect(plan.skipped.join(" ")).toMatch(/founder: destination is the source/);
    expect(plan.transfers.map((t) => t.role)).toEqual(["agent", "platform"]);
  });

  it("omitting founder args keeps legacy agent+platform behaviour", () => {
    const plan = planFeeDistribution({
      claimableAgentSol: 0.65,
      claimablePlatformSol: 0.05,
      agentWallet: AGENT,
      platformWallet: PLATFORM_SINK,
    });
    expect(plan.transfers.map((t) => t.role)).toEqual(["agent", "platform"]);
  });
});
