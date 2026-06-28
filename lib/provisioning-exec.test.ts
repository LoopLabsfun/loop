import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vercelProjectPayload, provisionProjectHome } from "./provisioning-exec";
import { provisionPlan } from "./provisioning";

describe("vercelProjectPayload", () => {
  it("builds a nextjs project linked to the project's repo", () => {
    const plan = provisionPlan("my-cool-project");
    const payload = vercelProjectPayload(plan) as {
      name: string;
      framework: string;
      gitRepository: { type: string; repo: string };
    };
    expect(payload.framework).toBe("nextjs");
    expect(payload.gitRepository).toEqual({ type: "github", repo: plan.repo });
    expect(payload.name).toBe(plan.vercelProject);
  });
});

describe("provisionProjectHome (unarmed)", () => {
  const env = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, VERCEL_TOKEN: process.env.VERCEL_TOKEN, VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID };
  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.VERCEL_TOKEN;
    delete process.env.VERCEL_TEAM_ID;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("no-ops (no network) when nothing is configured", async () => {
    const r = await provisionProjectHome("loop", "build a thing");
    expect(r.repoOk).toBe(false);
    expect(r.vercelOk).toBe(false);
    expect(r.note).toMatch(/unarmed/i);
    expect(r.repo).toBe(provisionPlan("loop").repo);
  });
});
