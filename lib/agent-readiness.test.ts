import { describe, it, expect } from "vitest";
import { scoreReadiness, hasRepo } from "./agent-readiness";

describe("hasRepo", () => {
  it("recognizes github urls, rejects others", () => {
    expect(hasRepo("github.com/you/project")).toBe(true);
    expect(hasRepo("https://github.com/a/b")).toBe(true);
    expect(hasRepo("evil.com/x")).toBe(false);
    expect(hasRepo("")).toBe(false);
    expect(hasRepo(undefined)).toBe(false);
  });
});

describe("scoreReadiness", () => {
  it("scores a vague one-liner as early", () => {
    const r = scoreReadiness({ prompt: "make me rich" });
    expect(r.level).toBe("early");
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.guidance).not.toBe("");
  });

  it("scores a concrete build + repo + tests as strong", () => {
    const r = scoreReadiness({
      prompt:
        "Build an open-source CLI that formats SQL, add unit tests and CI for every command.",
      repo: "github.com/you/sqlfmt",
    });
    expect(r.level).toBe("strong");
    expect(r.score).toBeGreaterThanOrEqual(3);
    expect(r.guidance).toBe("");
  });

  it("a repo alone makes verification + tooling met (workable)", () => {
    const r = scoreReadiness({ prompt: "do stuff", repo: "github.com/a/b" });
    const met = (k: string) => r.conditions.find((c) => c.key === k)!.met;
    expect(met("tooling")).toBe(true);
    expect(met("verifiable")).toBe(true);
    expect(met("budget")).toBe(true);
  });

  it("budget is always structurally met (market-funded)", () => {
    expect(scoreReadiness({ prompt: "" }).conditions.find((c) => c.key === "budget")!.met).toBe(
      true
    );
  });

  it("guidance points at the first unmet condition", () => {
    const r = scoreReadiness({ prompt: "Build and ship a real feature with code." });
    // repeatable met, budget met; first unmet should be verifiable → its hint.
    expect(r.guidance).toMatch(/checked|tests|CI/i);
  });
});
