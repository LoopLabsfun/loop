import { describe, it, expect } from "vitest";
import { repoSlugOf } from "./repo-lock";

describe("repoSlugOf", () => {
  it("normalizes a repo URL/slug to owner/name", () => {
    expect(repoSlugOf("github.com/LoopLabsfun/loop")).toBe("LoopLabsfun/loop");
    expect(repoSlugOf("https://github.com/LoopLabsfun/loop")).toBe("LoopLabsfun/loop");
    expect(repoSlugOf("https://github.com/LoopLabsfun/loop.git")).toBe("LoopLabsfun/loop");
    expect(repoSlugOf("github.com/LoopLabsfun/loop/")).toBe("LoopLabsfun/loop");
    expect(repoSlugOf("LoopLabsfun/loop")).toBe("LoopLabsfun/loop");
  });
});
