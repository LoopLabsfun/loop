import { describe, it, expect } from "vitest";
import {
  coerceSocial,
  buildSocialSystemPrompt,
  buildSocialUserPrompt,
} from "./agent-social";
import type { Project } from "./types";

const base: Project = {
  key: "demo" as Project["key"],
  name: "Demo Co",
  ticker: "DEMO",
  description: "A demo project.",
  official: false,
  launchpad: "Pump.fun",
  repo: "github.com/x/demo",
  cover: "neon",
  price: 0.0001,
  marketCap: "$30K",
  liquidity: "$4K",
  holders: "1",
  volume24h: "0 SOL",
  curve: 0.02,
  supply: "1B",
  treasurySol: 0,
  earnedSol: 0,
  burnPerDay: "0.10 SOL/day",
  runway: "booting",
};

describe("coerceSocial", () => {
  it("returns empty for non-objects", () => {
    expect(coerceSocial(null)).toEqual({});
    expect(coerceSocial("nope")).toEqual({});
    expect(coerceSocial(42)).toEqual({});
  });

  it("keeps a trimmed socialPlan and drops blank ones", () => {
    expect(coerceSocial({ socialPlan: "  my plan  " })).toEqual({ socialPlan: "my plan" });
    expect(coerceSocial({ socialPlan: "   " })).toEqual({});
  });

  it("clamps overlong fields", () => {
    const out = coerceSocial({
      socialPlan: "p".repeat(5000),
      posts: { x: "x".repeat(500), telegram: "t".repeat(2000) },
    });
    expect(out.socialPlan!.length).toBe(4000);
    expect(out.posts!.x!.length).toBe(270);
    expect(out.posts!.telegram!.length).toBe(1200);
  });

  it("omits absent or blank channels and drops empty posts entirely", () => {
    expect(coerceSocial({ posts: { x: "hello" } })).toEqual({ posts: { x: "hello" } });
    expect(coerceSocial({ posts: { x: "  ", telegram: "" } })).toEqual({});
    expect(coerceSocial({ posts: {} })).toEqual({});
  });
});

describe("buildSocialSystemPrompt", () => {
  it("always states the hard rails and the single allowed cashtag", () => {
    const sys = buildSocialSystemPrompt(base, { warmup: false });
    expect(sys).toContain("$DEMO"); // normalizes ticker → one cashtag
    expect(sys).toContain('NEVER write "loop.fun"');
    expect(sys).toContain("looplabs.fun");
    expect(sys.toLowerCase()).toContain("one cashtag");
  });

  it("warm-up asks ONLY for the plan, not posts", () => {
    const sys = buildSocialSystemPrompt(base, { warmup: true });
    expect(sys).toContain("SOCIAL WARM-UP");
    expect(sys).toContain("socialPlan");
    expect(sys).toMatch(/Omit "posts"/i);
  });

  it("normal cycle embeds a standing plan when given", () => {
    const sys = buildSocialSystemPrompt(base, { warmup: false, plan: "ROTATE ANGLES" });
    expect(sys).toContain("ROTATE ANGLES");
    expect(sys).toContain("STANDING CONTENT PLAN");
  });

  it("grounds the prompt in the mission and forbids inventing a thesis", () => {
    const sys = buildSocialSystemPrompt(base, {
      warmup: true,
      mission: "A launchpad where every project gets a token, treasury, and AI agent.",
    });
    expect(sys).toContain("A launchpad where every project gets a token");
    expect(sys).toMatch(/NEVER invent a product category/i);
  });

  it("falls back to the project description when no mission is passed", () => {
    const sys = buildSocialSystemPrompt(base, { warmup: false });
    expect(sys).toContain(base.description);
  });
});

describe("buildSocialUserPrompt", () => {
  it("marks shipped work as verified and asks to author", () => {
    const u = buildSocialUserPrompt({ title: "Add X", detail: "did Y", shipped: true, commitSha: "abcdef1234" });
    expect(u).toContain("SHIPPED (verified, pushed to main)");
    expect(u).toContain("commit: abcdef1");
    expect(u).toContain("Decide if this is post-worthy");
  });

  it("tells non-shipped cycles to stay silent unless warming up", () => {
    const u = buildSocialUserPrompt({ title: "WIP", detail: "", shipped: false });
    expect(u).toContain("in progress / not shipped");
    expect(u).toMatch(/return \{"posts":\{\}\}/);
  });
});
