import { describe, it, expect } from "vitest";
import {
  sanitizeLearning,
  rankLearnings,
  formatLearningsForPrompt,
  isDuplicateLearning,
  decayedScore,
  LEARNING_HALF_LIFE_DAYS,
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

  describe("time decay", () => {
    const NOW = Date.parse("2026-07-11T00:00:00Z");
    const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

    it("halves the effective score every half-life", () => {
      const fresh = decayedScore(mk({ upvotes: 9, at: daysAgo(0) }), NOW);
      const aged = decayedScore(
        mk({ upvotes: 9, at: daysAgo(LEARNING_HALF_LIFE_DAYS) }),
        NOW
      );
      expect(aged).toBeCloseTo(fresh / 2, 6);
    });

    it("a fresh still-earning insight outranks a stale once-popular one", () => {
      const out = rankLearnings(
        [
          mk({ insight: "stale hit", upvotes: 9, at: daysAgo(180) }),
          mk({ insight: "fresh signal", upvotes: 1, at: daysAgo(2) }),
        ],
        6,
        NOW
      );
      expect(out.map((l) => l.insight)).toEqual(["fresh signal", "stale hit"]);
    });

    it("an unparsable timestamp counts as fresh (no decay, no crash)", () => {
      expect(decayedScore(mk({ upvotes: 3, at: "now" }), NOW)).toBe(4);
    });

    it("dedupe keeps the entry with the higher effective (decayed) score", () => {
      const out = rankLearnings(
        [
          mk({ insight: "same lesson", upvotes: 9, at: daysAgo(300) }),
          mk({ insight: "Same lesson!", upvotes: 2, at: daysAgo(1) }),
        ],
        6,
        NOW
      );
      expect(out).toHaveLength(1);
      expect(out[0].upvotes).toBe(2);
    });
  });

  it("drops empty insights", () => {
    expect(rankLearnings([mk({ insight: "   " })])).toHaveLength(0);
  });
});

describe("isDuplicateLearning", () => {
  const existing = [mk({ insight: "Reply to leads within one hour." })];

  it("matches ignoring case and punctuation", () => {
    expect(isDuplicateLearning("reply to leads within one hour!!!", existing)).toBe(true);
  });
  it("treats a genuinely new insight as not a duplicate", () => {
    expect(isDuplicateLearning("Smaller PRs pass review faster.", existing)).toBe(false);
  });
  it("never persists an empty insight", () => {
    expect(isDuplicateLearning("   ", existing)).toBe(true);
    expect(isDuplicateLearning("", [])).toBe(true);
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
