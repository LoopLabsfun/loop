import { describe, it, expect } from "vitest";
import { formatCommunityForPrompt, type CommunityMessage } from "./discord-read";

describe("formatCommunityForPrompt", () => {
  it("renders one untrusted line per message with author + channel", () => {
    const msgs: CommunityMessage[] = [
      { author: "alice", channel: "ideas", content: "can the agent add a leaderboard?" },
      { author: "bob", channel: "general", content: "gm" },
    ];
    const out = formatCommunityForPrompt(msgs);
    expect(out).toContain("- alice in #ideas: can the agent add a leaderboard?");
    expect(out).toContain("- bob in #general: gm");
  });

  it("collapses whitespace and clamps long messages", () => {
    const out = formatCommunityForPrompt([
      { author: "x", channel: "general", content: "a\n\n  b   c " + "z".repeat(400) },
    ]);
    expect(out).not.toContain("\n\n");
    // one line, clamped to 240 chars of content
    const line = out.split("\n")[0];
    expect(line.length).toBeLessThanOrEqual(240 + "- x in #general: ".length);
  });

  it("returns a quiet placeholder when there's nothing", () => {
    expect(formatCommunityForPrompt([])).toBe("(no recent community messages)");
  });
});
