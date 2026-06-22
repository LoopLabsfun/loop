import { describe, it, expect } from "vitest";
import { brainMode, sdkSessionConfig } from "./agent-session-enqueue";

describe("brainMode", () => {
  it("defaults to legacy when unset or anything but 'sdk'", () => {
    expect(brainMode({})).toBe("legacy");
    expect(brainMode({ AGENT_BRAIN: "" })).toBe("legacy");
    expect(brainMode({ AGENT_BRAIN: "legacy" })).toBe("legacy");
    expect(brainMode({ AGENT_BRAIN: "SDK" })).toBe("legacy"); // exact match only
  });
  it("is sdk only for the exact value", () => {
    expect(brainMode({ AGENT_BRAIN: "sdk" })).toBe("sdk");
  });
});

describe("sdkSessionConfig", () => {
  it("uses generous durable defaults (not the 300s-squeezed inline ones)", () => {
    const c = sdkSessionConfig({});
    expect(c.model).toBe("claude-sonnet-4-6");
    expect(c.maxTurns).toBe(40);
    expect(c.wallMs).toBe(600_000);
    expect(c.timeoutMs).toBe(1_000_000);
  });
  it("honors overrides and caps maxTurns at 100", () => {
    const c = sdkSessionConfig({
      AGENT_SDK_MODEL: "claude-opus-4-8",
      AGENT_SDK_MAX_TURNS: "999",
      AGENT_SDK_WALL_MS: "300000",
      AGENT_SDK_TIMEOUT_MS: "450000",
    });
    expect(c.model).toBe("claude-opus-4-8");
    expect(c.maxTurns).toBe(100);
    expect(c.wallMs).toBe(300_000);
    expect(c.timeoutMs).toBe(450_000);
  });
  it("falls back to defaults on non-positive/garbage values", () => {
    const c = sdkSessionConfig({ AGENT_SDK_MAX_TURNS: "0", AGENT_SDK_WALL_MS: "nope" });
    expect(c.maxTurns).toBe(40);
    expect(c.wallMs).toBe(600_000);
  });
});
