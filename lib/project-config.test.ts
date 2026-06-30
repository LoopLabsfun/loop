import { describe, it, expect } from "vitest";
import { isConfigurableKnob, CONFIGURABLE_KNOBS } from "./project-config";

describe("isConfigurableKnob", () => {
  it("only accepts whitelisted runtime knobs", () => {
    expect(isConfigurableKnob("AGENT_TICK_COOLDOWN_MIN")).toBe(true);
    expect(isConfigurableKnob("AGENT_TICK_MIN_MIN")).toBe(true);
    expect(isConfigurableKnob("AGENT_TICK_MAX_MIN")).toBe(true);
    // not whitelisted — a config write must never inject an arbitrary env var
    expect(isConfigurableKnob("ANTHROPIC_API_KEY")).toBe(false);
    expect(isConfigurableKnob("GITHUB_TOKEN")).toBe(false);
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
