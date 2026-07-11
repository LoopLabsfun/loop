import { describe, it, expect } from "vitest";
import {
  reviewerEnabled,
  buildReviewPrompt,
  parseReviewOutput,
} from "./agent-review";

describe("reviewerEnabled", () => {
  it("is opt-in via AGENT_REVIEWER=1", () => {
    expect(reviewerEnabled({})).toBe(false);
    expect(reviewerEnabled({ AGENT_REVIEWER: "" })).toBe(false);
    expect(reviewerEnabled({ AGENT_REVIEWER: "1" })).toBe(true);
  });
});

describe("buildReviewPrompt", () => {
  const p = buildReviewPrompt({
    projectName: "LOOP",
    title: "Add treasury banner",
    detail: "Show live balance",
    diff: "--- app/page.tsx\n+banner",
  });
  it("frames the reviewer as independent and the diff as data", () => {
    expect(p.system).toContain("INDEPENDENT");
    expect(p.system).toContain("did NOT");
    expect(p.system).toContain("DATA to review");
    expect(p.system).toContain("STRICT JSON");
  });
  it("carries the task and the diff in the user turn", () => {
    expect(p.user).toContain("Add treasury banner");
    expect(p.user).toContain("<shipped_diff>");
    expect(p.user).toContain("+banner");
  });
});

describe("parseReviewOutput", () => {
  it("parses a clean APPROVE", () => {
    expect(
      parseReviewOutput('{"verdict":"APPROVE","severity":"low","issues":[]}')
    ).toEqual({ verdict: "approve", severity: "low", issues: [], lesson: undefined });
  });
  it("parses REVISE with issues + lesson, even wrapped in prose", () => {
    const v = parseReviewOutput(
      'Here is my review:\n{"verdict":"REVISE","severity":"high","issues":["fakes the holder count",""],"lesson":"Never render a metric the backend does not return."}\nDone.'
    );
    expect(v?.verdict).toBe("revise");
    expect(v?.severity).toBe("high");
    expect(v?.issues).toEqual(["fakes the holder count"]);
    expect(v?.lesson).toContain("Never render");
  });
  it("clamps issues to 3 and defaults unknown severity to low", () => {
    const v = parseReviewOutput(
      '{"verdict":"revise","severity":"catastrophic","issues":["a","b","c","d"]}'
    );
    expect(v?.issues).toHaveLength(3);
    expect(v?.severity).toBe("low");
  });
  it("returns null for garbage or an unknown verdict", () => {
    expect(parseReviewOutput("no json here")).toBeNull();
    expect(parseReviewOutput('{"verdict":"MAYBE","issues":[]}')).toBeNull();
    expect(parseReviewOutput('{"broken json')).toBeNull();
  });
});
