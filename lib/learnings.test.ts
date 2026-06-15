import { describe, it, expect } from "vitest";
import {
  sanitizeLearning,
  rankLearnings,
  formatLearningsForPrompt,
  type Learning,
} from "./learnings";

const mk = (over: Partial<Learning>): Learning => ({
  id: Math.random().toString(36).slice(2),
  category: "build",
  insight: "Ship the smallest reversible change first.",
  source: "a project",
  upvotes: 0,
  at: "now",
  ...over,
});

describe("sanitizeLearning", () => {
  it("collapses whitespace and caps length", () => {
    expect(sanitizeLearning("  a   b ")).toBe("a b");
    expect(sanitizeLearning("x".repeat(500)).length).toBe(240);
  });
});

describe("rankLearnings", () => {
  it("sorts by upvotes desc and respects the limit", () => {
    const out = rankLearnings(
      [
        mk({ insight: "low", upvotes: 1 }),
        mk({ insight: "high", upvotes: 9 }),
        mk({ insight: "mid", upvotes: 5 }),
      ],
      2
    );
    expect(out.map((l) => l.insight)).toEqual(["high", "mid"]);
  });

  it("dedupes equivalent insights, keeping the most-upvoted", () => {
    const out = rankLearnings([
      mk({ insight: "Cold DMs convert.", upvotes: 2 }),
      mk({ insight: "cold dms convert", upvotes: 7 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].upvotes).toBe(7);
  });

  it("drops empty insights", () => {
    expect(rankLearnings([mk({ insight: "   " })])).toHaveLength(0);
  });
});

describe("formatLearningsForPrompt", () => {
  it("falls back when there are none", () => {
    expect(formatLearningsForPrompt([])).toBe("(no shared learnings yet)");
  });
  it("renders category, insight, upvotes and source", () => {
    const line = formatLearningsForPrompt([
      mk({ category: "outreach", insight: "Reply within 1h.", upvotes: 4, source: "a tool" }),
    ]);
    expect(line).toContain("(outreach) Reply within 1h.");
    expect(line).toContain("4↑");
    expect(line).toContain("a tool");
  });
});
