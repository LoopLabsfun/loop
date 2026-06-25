import { describe, it, expect } from "vitest";
import { shouldSendRecap, recapEnabled, RECAP_MIN_SHIPS } from "./agent-recap";

const base = {
  enabled: true,
  official: true,
  socialReady: true,
  shippedTodayCount: RECAP_MIN_SHIPS,
  alreadySentToday: false,
};

describe("recapEnabled", () => {
  it("is on by default and only off when explicitly '0'", () => {
    expect(recapEnabled({})).toBe(true);
    expect(recapEnabled({ AGENT_DAILY_RECAP: "1" })).toBe(true);
    expect(recapEnabled({ AGENT_DAILY_RECAP: "0" })).toBe(false);
  });
});

describe("shouldSendRecap", () => {
  it("passes when official, ready, enough ships, not yet sent", () => {
    expect(shouldSendRecap(base).ok).toBe(true);
  });

  it("blocks when disabled / not official / not ready", () => {
    expect(shouldSendRecap({ ...base, enabled: false }).ok).toBe(false);
    expect(shouldSendRecap({ ...base, official: false }).ok).toBe(false);
    expect(shouldSendRecap({ ...base, socialReady: false }).ok).toBe(false);
  });

  it("is idempotent: blocks a second recap the same day", () => {
    const r = shouldSendRecap({ ...base, alreadySentToday: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/already recapped/);
  });

  it("requires a minimum number of ships to be worth posting", () => {
    expect(shouldSendRecap({ ...base, shippedTodayCount: 1 }).ok).toBe(false);
    expect(shouldSendRecap({ ...base, shippedTodayCount: 0 }).ok).toBe(false);
    expect(shouldSendRecap({ ...base, shippedTodayCount: 1, minShips: 1 }).ok).toBe(true);
  });
});
