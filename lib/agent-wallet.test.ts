import { describe, it, expect, afterEach } from "vitest";
import { agentWalletConfigured, walletExternalId } from "./agent-wallet";

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
});

describe("agentWalletConfigured", () => {
  it("is false unless both Privy creds are set", () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    expect(agentWalletConfigured()).toBe(false);
    process.env.PRIVY_APP_ID = "x";
    expect(agentWalletConfigured()).toBe(false);
    process.env.PRIVY_APP_SECRET = "y";
    expect(agentWalletConfigured()).toBe(true);
  });
});

describe("walletExternalId", () => {
  it("is deterministic and ≤ 64 chars", () => {
    expect(walletExternalId("loop")).toBe("loop-agent-loop");
    expect(walletExternalId("loop")).toBe(walletExternalId("loop"));
    expect(walletExternalId("x".repeat(100)).length).toBeLessThanOrEqual(64);
  });
});
