import { describe, it, expect } from "vitest";
import {
  recallKeywords,
  scoreRecallText,
  formatRecallForPrompt,
  recallEnabled,
  type RecallItem,
} from "./agent-recall";

describe("recallKeywords", () => {
  it("keeps discriminating tokens, drops stopwords and short words", () => {
    const kw = recallKeywords("Fix the treasury claim banner on the token page");
    expect(kw).toContain("treasury");
    expect(kw).toContain("banner");
    expect(kw).toContain("claim");
    expect(kw).not.toContain("the");
    expect(kw).not.toContain("fix"); // domain-generic
    expect(kw).not.toContain("page"); // domain-generic
  });
  it("dedupes, caps at max, and emits only [a-z0-9]+ tokens (PostgREST-safe)", () => {
    const kw = recallKeywords(
      "Treasury treasury TREASURY claim, claim; (banner) chart chart candle wallet inspector",
      4
    );
    expect(kw.length).toBeLessThanOrEqual(4);
    expect(new Set(kw).size).toBe(kw.length);
    for (const k of kw) expect(k).toMatch(/^[a-z0-9]+$/);
  });
  it("returns [] for an empty or all-generic query", () => {
    expect(recallKeywords("")).toEqual([]);
    expect(recallKeywords("fix the page and update it")).toEqual([]);
  });
});

describe("scoreRecallText", () => {
  it("counts keyword hits", () => {
    expect(scoreRecallText("shipped the treasury banner", ["treasury", "banner", "chart"])).toBe(2);
    expect(scoreRecallText("nothing relevant", ["treasury"])).toBe(0);
    expect(scoreRecallText("anything", [])).toBe(0);
  });
});

describe("formatRecallForPrompt", () => {
  const mk = (over: Partial<RecallItem>): RecallItem => ({
    kind: "shipped",
    text: "Treasury banner shipped",
    at: "2026-07-02T10:00:00Z",
    ...over,
  });
  it("renders kind + day + single-line text", () => {
    const out = formatRecallForPrompt([mk({})]);
    expect(out).toBe("- [shipped 2026-07-02] Treasury banner shipped");
  });
  it("stays under the char budget", () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      mk({ text: `memory number ${i} ${"x".repeat(120)}` })
    );
    const out = formatRecallForPrompt(items, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.split("\n").length).toBeGreaterThan(0);
  });
  it("returns empty string for no items", () => {
    expect(formatRecallForPrompt([])).toBe("");
  });
});

describe("recallEnabled", () => {
  it("is on by default and opt-out via AGENT_RECALL=0", () => {
    expect(recallEnabled({})).toBe(true);
    expect(recallEnabled({ AGENT_RECALL: "1" })).toBe(true);
    expect(recallEnabled({ AGENT_RECALL: "0" })).toBe(false);
  });
});
