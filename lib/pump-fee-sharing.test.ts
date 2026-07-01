import { describe, it, expect } from "vitest";
import { buildShareholders, pumpFeeSharingEnabled } from "./pump-fee-sharing";

const FOUNDER = "DrUJpyCnAwJ7JTCjqNoxjyEaXMMcSVQLZ2bzGntt8xeT";
const AGENT = "HCpXujcA9mdBN3fES2DjYbf6AjNwk9bNDpG2dFb1ePAe";
const PLATFORM = "BXdPPqDwYBGxAqSJyC1kZKtjXo3agAtP2Sfk1L2r1rXp";

describe("pumpFeeSharingEnabled", () => {
  it("is off unless PUMP_FEE_SHARING=1", () => {
    expect(pumpFeeSharingEnabled({})).toBe(false);
    expect(pumpFeeSharingEnabled({ PUMP_FEE_SHARING: "0" })).toBe(false);
    expect(pumpFeeSharingEnabled({ PUMP_FEE_SHARING: "1" })).toBe(true);
  });
});

describe("buildShareholders", () => {
  it("builds the standard 30/65/5 split across three distinct wallets", () => {
    const r = buildShareholders({ founderWallet: FOUNDER, agentWallet: AGENT, platformWallet: PLATFORM }, 30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shareholders).toEqual(
      expect.arrayContaining([
        { address: FOUNDER, shareBps: 3000 },
        { address: AGENT, shareBps: 6500 },
        { address: PLATFORM, shareBps: 500 },
      ]),
    );
    expect(r.shareholders.reduce((s, x) => s + x.shareBps, 0)).toBe(10_000);
  });

  it("falls back to the default split (30/65/5) when founderPct is missing", () => {
    const r = buildShareholders({ founderWallet: FOUNDER, agentWallet: AGENT, platformWallet: PLATFORM }, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shareholders.find((s) => s.address === FOUNDER)?.shareBps).toBe(3000);
  });

  it("merges two roles that share the same wallet instead of producing a duplicate", () => {
    const r = buildShareholders({ founderWallet: FOUNDER, agentWallet: FOUNDER, platformWallet: PLATFORM }, 30);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shareholders).toHaveLength(2);
    expect(r.shareholders.find((s) => s.address === FOUNDER)?.shareBps).toBe(9500); // 30 + 65
    const total = r.shareholders.reduce((s, x) => s + x.shareBps, 0);
    expect(total).toBe(10_000);
  });

  it("rejects when a required wallet is missing or invalid", () => {
    const r1 = buildShareholders({ founderWallet: null, agentWallet: AGENT, platformWallet: PLATFORM }, 30);
    expect(r1.ok).toBe(false);
    const r2 = buildShareholders({ founderWallet: "not-a-wallet", agentWallet: AGENT, platformWallet: PLATFORM }, 30);
    expect(r2.ok).toBe(false);
  });

  it("never returns a share total other than exactly 10,000 bps", () => {
    for (const pct of [0, 1, 30, 50, 94, 95]) {
      const r = buildShareholders({ founderWallet: FOUNDER, agentWallet: AGENT, platformWallet: PLATFORM }, pct);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.shareholders.reduce((s, x) => s + x.shareBps, 0)).toBe(10_000);
    }
  });
});
