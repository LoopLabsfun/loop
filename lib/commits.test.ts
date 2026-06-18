import { describe, it, expect } from "vitest";
import { pruneRepoTree, sanitizeReadPaths } from "./commits";

describe("sanitizeReadPaths", () => {
  it("strips ./ , dedupes, and caps", () => {
    const out = sanitizeReadPaths(
      ["./lib/a.ts", "lib/a.ts", "lib/b.ts", "lib/c.ts"],
      2
    );
    expect(out).toEqual(["lib/a.ts", "lib/b.ts"]);
  });

  it("rejects absolute paths and ../ traversal", () => {
    const out = sanitizeReadPaths([
      "/etc/passwd",
      "../secrets.txt",
      "lib/../../x",
      "lib/ok.ts",
    ]);
    expect(out).toEqual(["lib/ok.ts"]);
  });

  it("is empty-safe and drops blanks", () => {
    expect(sanitizeReadPaths(["", "   "])).toEqual([]);
  });
});

describe("pruneRepoTree", () => {
  it("drops deps, build output, lockfiles and binaries; keeps source", () => {
    const raw = [
      "lib/agent-runtime.ts",
      "components/token/AgentOperator.tsx",
      "node_modules/react/index.js",
      ".next/server/app/page.js",
      "package-lock.json",
      "public/logo.svg",
      "app/favicon.ico",
      "README.md",
    ];
    const out = pruneRepoTree(raw);
    expect(out).toContain("lib/agent-runtime.ts");
    expect(out).toContain("components/token/AgentOperator.tsx");
    expect(out).toContain("README.md");
    expect(out.some((p) => p.includes("node_modules"))).toBe(false);
    expect(out.some((p) => p.startsWith(".next/"))).toBe(false);
    expect(out).not.toContain("package-lock.json");
    expect(out).not.toContain("public/logo.svg");
    expect(out).not.toContain("app/favicon.ico");
  });

  it("sorts and hard-caps the list", () => {
    const raw = Array.from({ length: 500 }, (_, i) => `lib/f${String(i).padStart(3, "0")}.ts`);
    const out = pruneRepoTree(raw, 240);
    expect(out.length).toBe(240);
    expect(out[0]).toBe("lib/f000.ts"); // sorted ascending
  });

  it("is empty-safe", () => {
    expect(pruneRepoTree([])).toEqual([]);
  });
});
