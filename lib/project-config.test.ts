import { describe, it, expect } from "vitest";
import { isConfigurableKnob, CONFIGURABLE_KNOBS } from "./project-config";

describe("isConfigurableKnob", () => {
  it("only accepts whitelisted runtime knobs", () => {
    expect(isConfigurableKnob("AGENT_TICK_COOLDOWN_MIN")).toBe(true);
    expect(isConfigurableKnob("AGENT_TICK_MIN_MIN")).toBe(true);
    expect(isConfigurableKnob("AGENT_TICK_MAX_MIN")).toBe(true);
    // Lot 5b: model/effort/compute-saver knobs, all wired through effectiveEnv()
    // at their actual read sites (decideNextAction, enqueueSdkSession).
    expect(isConfigurableKnob("AGENT_SDK_MODEL")).toBe(true);
    expect(isConfigurableKnob("AGENT_SDK_EFFORT")).toBe(true);
    expect(isConfigurableKnob("AGENT_READ_ROUNDS")).toBe(true);
    expect(isConfigurableKnob("COMPUTE_SAVER")).toBe(true);
    expect(isConfigurableKnob("COMPUTE_SAVER_MIN_PRIORITY")).toBe(true);
    // not whitelisted — a config write must never inject an arbitrary env var.
    // COMPUTE_BUDGET_GATE deliberately stays platform-only: it's read before the
    // per-project selection loop in the cron (app/api/agent/cron/route.ts), so a
    // per-project override there would silently waste a MAX_PER_RUN slot rather
    // than actually gate that project's spend.
    expect(isConfigurableKnob("ANTHROPIC_API_KEY")).toBe(false);
    expect(isConfigurableKnob("GITHUB_TOKEN")).toBe(false);
    expect(isConfigurableKnob("AGENT_DECISION_MODEL")).toBe(false);
    expect(isConfigurableKnob("COMPUTE_BUDGET_GATE")).toBe(false);
    expect(isConfigurableKnob("")).toBe(false);
  });

  it("every whitelisted knob has a key, label and hint", () => {
    for (const k of CONFIGURABLE_KNOBS) {
      expect(k.key).toBeTruthy();
      expect(k.label).toBeTruthy();
      expect(k.hint).toBeTruthy();
    }
  });
});
