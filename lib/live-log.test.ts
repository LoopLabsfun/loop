import { describe, it, expect } from "vitest";
import { commitHashForTitle, shareOnXUrl } from "./live-log";

describe("commitHashForTitle", () => {
  const commits = [
    { hash: "3a0d29e", msg: "fix(agent): self-heal the task queue once its commit is on main" },
    { hash: "ccb0b4a", msg: "feat(treasury): real on-chain claims + home inspector panel" },
    { hash: "0000000", msg: "chore: unrelated maintenance" },
  ];

  it("returns the SHA of the commit whose message contains the title", () => {
    expect(
      commitHashForTitle("real on-chain claims + home inspector panel", commits)
    ).toBe("ccb0b4a");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(
      commitHashForTitle("  SELF-HEAL the   task queue once its commit is on main ", commits)
    ).toBe("3a0d29e");
  });

  it("returns null when no commit matches", () => {
    expect(commitHashForTitle("a task nobody has committed yet", commits)).toBeNull();
  });

  it("returns null for trivially short titles (avoids false matches)", () => {
    expect(commitHashForTitle("fix", [{ hash: "abc1234", msg: "fix(agent): fix it" }])).toBeNull();
  });

  it("returns the first matching commit when several would match", () => {
    const dup = [
      { hash: "newest1", msg: "fix(agent): tweak the live treasury panel layout" },
      { hash: "older22", msg: "feat(agent): tweak the live treasury panel layout again" },
    ];
    expect(commitHashForTitle("tweak the live treasury panel layout", dup)).toBe("newest1");
  });
});

describe("shareOnXUrl", () => {
  it("returns an X intent URL", () => {
    const url = shareOnXUrl("add dark mode to dashboard");
    expect(url).toMatch(/^https:\/\/x\.com\/intent\/tweet\?text=/);
  });

  it("includes the task title, @Looplabsfun, and looplabs.fun in the encoded text", () => {
    const url = shareOnXUrl("add dark mode to dashboard");
    const text = decodeURIComponent(url.replace("https://x.com/intent/tweet?text=", ""));
    expect(text).toContain("add dark mode to dashboard");
    expect(text).toContain("@Looplabsfun");
    expect(text).toContain("looplabs.fun");
  });

  it("URL-encodes special characters in the title", () => {
    const url = shareOnXUrl("fix: handle #1 & update <config>");
    expect(url).not.toContain("#");
    expect(url).not.toContain("&");
    expect(url).not.toContain("<");
  });
});
