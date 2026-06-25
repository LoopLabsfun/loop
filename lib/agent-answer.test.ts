import { describe, it, expect } from "vitest";
import { looksLikeQuestion, communityAnswerArmed } from "./agent-answer";

describe("communityAnswerArmed", () => {
  it("is armed only by an explicit AGENT_COMMUNITY_ANSWER=1 (default off)", () => {
    expect(communityAnswerArmed({})).toBe(false);
    expect(communityAnswerArmed({ AGENT_COMMUNITY_ANSWER: "0" })).toBe(false);
    expect(communityAnswerArmed({ AGENT_COMMUNITY_ANSWER: "1" })).toBe(true);
  });
});

describe("looksLikeQuestion", () => {
  it("accepts real questions (with ? or an interrogative opener)", () => {
    expect(looksLikeQuestion("how does the agent fund itself?")).toBe(true);
    expect(looksLikeQuestion("What is Loop building right now")).toBe(true);
    expect(looksLikeQuestion("can it trade its own token?")).toBe(true);
    expect(looksLikeQuestion("comment ça marche le treasury ?")).toBe(true);
  });
  it("accepts a message that addresses the project", () => {
    expect(looksLikeQuestion("loop when token utility?", { names: ["loop"] })).toBe(true);
  });
  it("rejects noise, statements, and one-word spam", () => {
    expect(looksLikeQuestion("gm")).toBe(false);
    expect(looksLikeQuestion("lfg 🚀")).toBe(false);
    expect(looksLikeQuestion("this is cool")).toBe(false);
    expect(looksLikeQuestion("?")).toBe(false);
    expect(looksLikeQuestion("")).toBe(false);
  });
  it("rejects an over-long paste", () => {
    expect(looksLikeQuestion("a".repeat(1200) + "?")).toBe(false);
  });
});
