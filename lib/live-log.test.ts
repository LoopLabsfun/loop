import { describe, it, expect } from "vitest";
import { commitHashForTitle } from "./live-log";

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
