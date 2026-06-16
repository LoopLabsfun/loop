import { describe, it, expect } from "vitest";
import { sanitizeLaunch, slugify, NAME_MAX, PROMPT_MAX } from "./launch";

describe("slugify", () => {
  it("lowercases the ticker and strips non-alphanumerics", () => {
    expect(slugify("AI-VID", "Whatever")).toBe("aivid");
  });
  it("falls back to the name when ticker is empty", () => {
    expect(slugify("", "Open Source Cursor")).toBe("opensourcecursor");
  });
  it("falls back to 'project' when nothing usable is left", () => {
    expect(slugify("", "")).toBe("project");
    expect(slugify("$$$", "")).toBe("project");
  });
});

describe("sanitizeLaunch", () => {
  it("normalizes a valid input", () => {
    const out = sanitizeLaunch({
      name: "  Open   Source  Cursor ",
      ticker: " oscur ",
      prompt: "  build it  ",
      repo: "https://github.com/you/project",
    });
    expect(out).toEqual({
      name: "Open Source Cursor",
      ticker: "OSCUR",
      prompt: "build it",
      repo: "https://github.com/you/project",
      feeFounderPct: 30, // default split when unset
    });
  });

  it("defaults, clamps, and rounds the founder fee share", () => {
    const base = { name: "X", ticker: "ABC", prompt: "" };
    expect(sanitizeLaunch(base).feeFounderPct).toBe(30); // unset → default
    expect(sanitizeLaunch({ ...base, feeFounderPct: 70 }).feeFounderPct).toBe(70);
    expect(sanitizeLaunch({ ...base, feeFounderPct: 200 }).feeFounderPct).toBe(95); // clamp to max
    expect(sanitizeLaunch({ ...base, feeFounderPct: -10 }).feeFounderPct).toBe(0); // clamp to min
    expect(sanitizeLaunch({ ...base, feeFounderPct: 30.6 }).feeFounderPct).toBe(31); // round
  });

  it("uppercases and strips junk from the ticker", () => {
    expect(sanitizeLaunch({ name: "X", ticker: "a-b_c1", prompt: "" }).ticker).toBe(
      "ABC1"
    );
  });

  it("requires a name", () => {
    expect(() => sanitizeLaunch({ name: "   ", ticker: "OSCUR", prompt: "" })).toThrow(
      /name is required/i
    );
  });

  it("rejects a too-short ticker", () => {
    expect(() => sanitizeLaunch({ name: "X", ticker: "A", prompt: "" })).toThrow(
      /ticker/i
    );
  });

  it("rejects a ticker longer than 10 chars only after the cap still fails min/charset", () => {
    // 11 valid chars are capped to 10 → still valid
    expect(sanitizeLaunch({ name: "X", ticker: "ABCDEFGHIJK", prompt: "" }).ticker).toBe(
      "ABCDEFGHIJ"
    );
  });

  it("drops a non-GitHub repo, keeps a GitHub one", () => {
    expect(
      sanitizeLaunch({ name: "X", ticker: "OSCUR", prompt: "", repo: "evil.com/x" })
        .repo
    ).toBe("");
    expect(
      sanitizeLaunch({
        name: "X",
        ticker: "OSCUR",
        prompt: "",
        repo: "github.com/a/b",
      }).repo
    ).toBe("github.com/a/b");
  });

  it("caps name and prompt length", () => {
    const out = sanitizeLaunch({
      name: "n".repeat(200),
      ticker: "OSCUR",
      prompt: "p".repeat(5000),
    });
    expect(out.name.length).toBe(NAME_MAX);
    expect(out.prompt.length).toBe(PROMPT_MAX);
  });
});
