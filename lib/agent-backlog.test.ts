import { describe, it, expect } from "vitest";
import {
  effectivePriority,
  rankBacklog,
  classifyPath,
  classifyChangedPaths,
  isBusyworkOnly,
  SOURCE_BASE_PRIORITY,
  type RankedTask,
} from "./agent-backlog";

function task(over: Partial<RankedTask> & { status: string }): RankedTask {
  return {
    id: over.id ?? "t1",
    title: over.title ?? "x",
    detail: "",
    category: "feature",
    at: "",
    priority: over.priority as number,
    source: over.source ?? "agent",
    ...over,
  } as RankedTask;
}

describe("effectivePriority", () => {
  it("uses an explicit priority when set", () => {
    expect(effectivePriority({ priority: 42, source: "agent" })).toBe(42);
    expect(effectivePriority({ priority: 0, source: "founder" })).toBe(0); // explicit 0 wins over the band
  });
  it("falls back to the source band when no priority is set", () => {
    expect(effectivePriority({ source: "founder" })).toBe(SOURCE_BASE_PRIORITY.founder);
    expect(effectivePriority({ source: "holder" })).toBe(SOURCE_BASE_PRIORITY.holder);
    expect(effectivePriority({})).toBe(SOURCE_BASE_PRIORITY.agent);
    expect(effectivePriority({ priority: NaN, source: "holder" })).toBe(SOURCE_BASE_PRIORITY.holder);
  });

  describe("staleness boost", () => {
    const DAY = 86_400_000;
    const now = Date.parse("2026-06-30T12:00:00Z");

    it("grows an unprioritised agent task's priority by 2/day, capped at 20", () => {
      expect(effectivePriority({ source: "agent", createdAtMs: now }, now)).toBe(0); // brand new
      expect(effectivePriority({ source: "agent", createdAtMs: now - 3 * DAY }, now)).toBe(6);
      expect(effectivePriority({ source: "agent", createdAtMs: now - 30 * DAY }, now)).toBe(20); // capped
    });

    it("never lets an aged agent task reach the holder/founder band", () => {
      const boosted = effectivePriority({ source: "agent", createdAtMs: now - 365 * DAY }, now);
      expect(boosted).toBeLessThan(SOURCE_BASE_PRIORITY.holder);
    });

    it("does not apply to founder/holder tasks or when createdAtMs is absent", () => {
      expect(effectivePriority({ source: "holder", createdAtMs: now - 30 * DAY }, now)).toBe(
        SOURCE_BASE_PRIORITY.holder
      );
      expect(effectivePriority({ source: "agent" }, now)).toBe(SOURCE_BASE_PRIORITY.agent);
    });

    it("an explicit priority still wins over the staleness boost", () => {
      expect(effectivePriority({ source: "agent", priority: 5, createdAtMs: now - 30 * DAY }, now)).toBe(5);
    });
  });
});

describe("rankBacklog", () => {
  it("ranks only todo items, highest effective priority first", () => {
    const tasks = [
      task({ id: "a", status: "todo", source: "agent" }), // 0
      task({ id: "b", status: "todo", source: "founder" }), // 100
      task({ id: "c", status: "building", source: "founder" }), // ignored (not todo)
      task({ id: "d", status: "todo", source: "holder" }), // 50
    ];
    const { ranked, top } = rankBacklog(tasks);
    expect(ranked.map((t) => t.id)).toEqual(["b", "d", "a"]);
    expect(top?.id).toBe("b");
  });

  it("an explicit priority overrides the source band", () => {
    const tasks = [
      task({ id: "agentUrgent", status: "todo", source: "agent", priority: 200 }),
      task({ id: "founderNormal", status: "todo", source: "founder" }), // 100
    ];
    expect(rankBacklog(tasks).top?.id).toBe("agentUrgent");
  });

  it("is a stable sort within a priority band (preserves incoming order)", () => {
    const tasks = [
      task({ id: "first", status: "todo", source: "agent" }),
      task({ id: "second", status: "todo", source: "agent" }),
      task({ id: "third", status: "todo", source: "agent" }),
    ];
    expect(rankBacklog(tasks).ranked.map((t) => t.id)).toEqual(["first", "second", "third"]);
  });

  it("returns a null top when there is no todo work", () => {
    expect(rankBacklog([task({ status: "shipped" }), task({ status: "building" })]).top).toBeNull();
  });

  describe("category fairness", () => {
    it("boosts a category absent from recently-shipped work above a same-band peer", () => {
      const tasks = [
        task({ id: "feature", status: "todo", source: "agent", category: "feature" }),
        task({ id: "ops", status: "todo", source: "agent", category: "ops" }),
        // Only "feature" has shipped recently — "ops" is starved and should rank first.
        task({ id: "s1", status: "shipped", category: "feature" }),
        task({ id: "s2", status: "shipped", category: "feature" }),
      ];
      expect(rankBacklog(tasks).top?.id).toBe("ops");
    });

    it("never lets the fairness boost outrank a founder/holder ask", () => {
      const tasks = [
        task({ id: "founderFeature", status: "todo", source: "founder", category: "feature" }),
        task({ id: "agentOps", status: "todo", source: "agent", category: "ops" }), // starved category
        task({ id: "shippedFeature", status: "shipped", category: "feature" }),
      ];
      expect(rankBacklog(tasks).top?.id).toBe("founderFeature");
    });

    it("applies no boost when no category has shipped yet (uniform — preserves prior ordering)", () => {
      const tasks = [
        task({ id: "a", status: "todo", source: "agent", category: "feature" }),
        task({ id: "b", status: "todo", source: "founder", category: "fix" }),
      ];
      expect(rankBacklog(tasks).top?.id).toBe("b"); // founder band still wins, no category skew
    });
  });
});

describe("classifyPath", () => {
  it("marks pages, components and styling as visible", () => {
    for (const p of ["app/page.tsx", "app/token/page.tsx", "components/token/TokenPage.tsx", "app/globals.css", "tailwind.config.ts"]) {
      expect(classifyPath(p)).toBe("visible");
    }
  });
  it("marks API routes and lib logic as functional", () => {
    for (const p of ["app/api/follow/route.ts", "lib/market.ts", "lib/agent-runtime.ts"]) {
      expect(classifyPath(p)).toBe("functional");
    }
  });
  it("marks tests, docs, scripts, config and the hardened util family as trivial", () => {
    for (const p of [
      "lib/format.test.ts",
      "components/Foo.spec.tsx",
      "docs/agent.md",
      "README.md",
      "scripts/post.ts",
      ".github/workflows/ci.yml",
      "supabase/schema.sql",
      "package.json",
      "next.config.js",
      "lib/format.ts",
    ]) {
      expect(classifyPath(p)).toBe("trivial");
    }
  });
  it("normalizes leading ./ and /", () => {
    expect(classifyPath("./components/X.tsx")).toBe("visible");
    expect(classifyPath("/lib/format.ts")).toBe("trivial");
  });
});

describe("classifyChangedPaths", () => {
  it("buckets a mixed diff and skips blanks", () => {
    const c = classifyChangedPaths(["components/X.tsx", "lib/market.ts", "lib/format.ts", "", "  "]);
    expect(c.visible).toEqual(["components/X.tsx"]);
    expect(c.functional).toEqual(["lib/market.ts"]);
    expect(c.trivial).toEqual(["lib/format.ts"]);
  });
});

describe("isBusyworkOnly", () => {
  it("is true when the whole diff is trivial (the busywork pattern)", () => {
    expect(isBusyworkOnly(["lib/format.ts", "lib/format.test.ts"])).toBe(true);
    expect(isBusyworkOnly(["docs/x.md"])).toBe(true);
  });
  it("is false when any visible or functional file changed", () => {
    expect(isBusyworkOnly(["lib/format.ts", "components/X.tsx"])).toBe(false); // ships a visible change too
    expect(isBusyworkOnly(["lib/market.ts"])).toBe(false);
    expect(isBusyworkOnly(["app/api/follow/route.ts", "lib/format.test.ts"])).toBe(false);
  });
  it("is false for an empty diff (no claim either way)", () => {
    expect(isBusyworkOnly([])).toBe(false);
    expect(isBusyworkOnly(["", "  "])).toBe(false);
  });
});
