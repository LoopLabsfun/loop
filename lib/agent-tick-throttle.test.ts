import { describe, it, expect } from "vitest";
import {
  tickCooldownMs,
  DEFAULT_TICK_COOLDOWN_MIN,
  staleBuildMs,
  DEFAULT_STALE_BUILD_MIN,
} from "./agent-tick-throttle";

describe("tickCooldownMs", () => {
  it("defaults to the conservative cooldown when unset", () => {
    expect(tickCooldownMs({})).toBe(DEFAULT_TICK_COOLDOWN_MIN * 60_000);
  });

  it("honours an explicit positive minute value", () => {
    expect(tickCooldownMs({ AGENT_TICK_COOLDOWN_MIN: "30" })).toBe(30 * 60_000);
    expect(tickCooldownMs({ AGENT_TICK_COOLDOWN_MIN: "5" })).toBe(5 * 60_000);
  });

  it("trims whitespace", () => {
    expect(tickCooldownMs({ AGENT_TICK_COOLDOWN_MIN: " 15 " })).toBe(15 * 60_000);
  });

  it("disables ONLY on an explicit '0'", () => {
    expect(tickCooldownMs({ AGENT_TICK_COOLDOWN_MIN: "0" })).toBe(0);
  });

  it("falls back to the default on garbage / negative / empty (never silently disables)", () => {
    const def = DEFAULT_TICK_COOLDOWN_MIN * 60_000;
    expect(tickCooldownMs({ AGENT_TICK_COOLDOWN_MIN: "" })).toBe(def);
    expect(tickCooldownMs({ AGENT_TICK_COOLDOWN_MIN: "nope" })).toBe(def);
    expect(tickCooldownMs({ AGENT_TICK_COOLDOWN_MIN: "-10" })).toBe(def);
    expect(tickCooldownMs({ AGENT_TICK_COOLDOWN_MIN: "NaN" })).toBe(def);
  });

  it("rounds fractional minutes to whole milliseconds", () => {
    expect(tickCooldownMs({ AGENT_TICK_COOLDOWN_MIN: "0.5" })).toBe(30_000);
  });
});

describe("staleBuildMs", () => {
  it("defaults to the conservative stale window when unset", () => {
    expect(staleBuildMs({})).toBe(DEFAULT_STALE_BUILD_MIN * 60_000);
  });

  it("honours an explicit positive minute value", () => {
    expect(staleBuildMs({ AGENT_STALE_BUILD_MIN: "120" })).toBe(120 * 60_000);
  });

  it("falls back to the default on garbage / non-positive (never reaps a live session)", () => {
    const def = DEFAULT_STALE_BUILD_MIN * 60_000;
    expect(staleBuildMs({ AGENT_STALE_BUILD_MIN: "0" })).toBe(def);
    expect(staleBuildMs({ AGENT_STALE_BUILD_MIN: "-5" })).toBe(def);
    expect(staleBuildMs({ AGENT_STALE_BUILD_MIN: "" })).toBe(def);
    expect(staleBuildMs({ AGENT_STALE_BUILD_MIN: "nope" })).toBe(def);
  });
});
