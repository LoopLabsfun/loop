import { describe, it, expect, afterEach } from "vitest";
import {
  NO_DEPLOY_MARKER,
  hasNoDeployMarker,
  appendNoDeployMarker,
  shouldDeployNow,
  deployThrottleConfig,
} from "./deploy-throttle";

describe("hasNoDeployMarker", () => {
  it("detects the marker only as a whole standalone line", () => {
    expect(hasNoDeployMarker(`feat: x\n\n${NO_DEPLOY_MARKER}`)).toBe(true);
    expect(hasNoDeployMarker("feat: x")).toBe(false);
  });

  it("does NOT match a prose mention (mirrors Vercel's grep -x)", () => {
    // The commit that introduced this feature mentions `[no-deploy]` inline;
    // it must still deploy. Only a standalone trailer line skips the build.
    expect(hasNoDeployMarker("perf: explain the [no-deploy] marker")).toBe(false);
    expect(hasNoDeployMarker("stamps `[no-deploy]` on work-commits")).toBe(false);
  });
});

describe("appendNoDeployMarker", () => {
  it("appends the marker as a body trailer (never on the subject line)", () => {
    const out = appendNoDeployMarker("feat(agent): ship thing");
    expect(out.split("\n")[0]).toBe("feat(agent): ship thing"); // subject untouched
    expect(hasNoDeployMarker(out)).toBe(true);
    expect(out).toContain(`\n\n${NO_DEPLOY_MARKER}`);
  });

  it("is idempotent — never double-stamps", () => {
    const once = appendNoDeployMarker("feat: x");
    expect(appendNoDeployMarker(once)).toBe(once);
  });
});

describe("shouldDeployNow", () => {
  const minIntervalMs = 60 * 60_000; // 60 min

  it("deploys when the last deploy is unknown (safe default)", () => {
    expect(shouldDeployNow({ lastDeployAtMs: null, nowMs: 1_000, minIntervalMs })).toBe(true);
  });

  it("suppresses a deploy that is too recent", () => {
    const now = 10_000_000;
    expect(
      shouldDeployNow({ lastDeployAtMs: now - 5 * 60_000, nowMs: now, minIntervalMs })
    ).toBe(false);
  });

  it("deploys once the interval has elapsed", () => {
    const now = 10_000_000;
    expect(
      shouldDeployNow({ lastDeployAtMs: now - 61 * 60_000, nowMs: now, minIntervalMs })
    ).toBe(true);
    // exactly at the boundary counts as elapsed
    expect(
      shouldDeployNow({ lastDeployAtMs: now - minIntervalMs, nowMs: now, minIntervalMs })
    ).toBe(true);
  });
});

describe("deployThrottleConfig", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env.DEPLOY_THROTTLE = saved.DEPLOY_THROTTLE;
    process.env.DEPLOY_MIN_INTERVAL_MIN = saved.DEPLOY_MIN_INTERVAL_MIN;
  });

  it("is OFF by default", () => {
    delete process.env.DEPLOY_THROTTLE;
    expect(deployThrottleConfig().enabled).toBe(false);
  });

  it("enables on '1' and reads the interval", () => {
    process.env.DEPLOY_THROTTLE = "1";
    process.env.DEPLOY_MIN_INTERVAL_MIN = "30";
    const cfg = deployThrottleConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.minIntervalMs).toBe(30 * 60_000);
  });

  it("falls back to 60m on a missing/garbage interval", () => {
    process.env.DEPLOY_THROTTLE = "1";
    delete process.env.DEPLOY_MIN_INTERVAL_MIN;
    expect(deployThrottleConfig().minIntervalMs).toBe(60 * 60_000);
    process.env.DEPLOY_MIN_INTERVAL_MIN = "nope";
    expect(deployThrottleConfig().minIntervalMs).toBe(60 * 60_000);
  });
});
