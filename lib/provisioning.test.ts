import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_GITHUB_ORG,
  safeName,
  provisionPlan,
  githubConfigured,
  vercelConfigured,
  provisioningEnabled,
} from "./provisioning";

describe("safeName", () => {
  it("lowercases and slugifies to [a-z0-9-]", () => {
    expect(safeName("My Cool Project")).toBe("my-cool-project");
    expect(safeName("GTA_VI!!")).toBe("gta-vi");
  });
  it("collapses dash runs and trims leading/trailing dashes", () => {
    expect(safeName("--a__b  c--")).toBe("a-b-c");
  });
  it("caps length and never leaves a trailing dash", () => {
    const out = safeName("x".repeat(200));
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("-")).toBe(false);
  });
  it("falls back to a stable default for empty/garbage", () => {
    expect(safeName("")).toBe("project");
    expect(safeName("!!!")).toBe("project");
    // @ts-expect-error — defensive against non-string callers
    expect(safeName(null)).toBe("project");
  });
});

describe("provisionPlan", () => {
  it("homes a project under the Loop org with the owner/name repo shape", () => {
    const p = provisionPlan("loop");
    expect(p.org).toBe(DEFAULT_GITHUB_ORG);
    expect(p.repo).toBe("loop-labs/loop");
    expect(p.repoUrl).toBe("https://github.com/loop-labs/loop");
    expect(p.vercelProject).toBe("loop");
    expect(p.vercelUrl).toBe("https://loop.vercel.app");
  });
  it("is deterministic — same key maps to the same home (idempotent)", () => {
    expect(provisionPlan("aivid")).toEqual(provisionPlan("aivid"));
  });
  it("sanitizes the key into a valid repo name", () => {
    expect(provisionPlan("My Token #1").repo).toBe("loop-labs/my-token-1");
  });
  it("accepts an org override", () => {
    expect(provisionPlan("x", { org: "Other Org" }).repo).toBe("other-org/x");
  });
});

describe("execution gates (env)", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  it("github gate is off without a token, on with one", () => {
    delete process.env.GITHUB_TOKEN;
    expect(githubConfigured()).toBe(false);
    process.env.GITHUB_TOKEN = "ghp_x";
    expect(githubConfigured()).toBe(true);
  });
  it("vercel gate needs BOTH token and team id", () => {
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_TEAM_ID;
    expect(vercelConfigured()).toBe(false);
    process.env.VERCEL_TOKEN = "v_x";
    expect(vercelConfigured()).toBe(false);
    process.env.VERCEL_TEAM_ID = "team_x";
    expect(vercelConfigured()).toBe(true);
  });
  it("provisioningEnabled requires both halves", () => {
    delete process.env.GITHUB_TOKEN;
    process.env.VERCEL_TOKEN = "v_x";
    process.env.VERCEL_TEAM_ID = "team_x";
    expect(provisioningEnabled()).toBe(false);
    process.env.GITHUB_TOKEN = "ghp_x";
    expect(provisioningEnabled()).toBe(true);
  });
});
