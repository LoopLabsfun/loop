import { describe, it, expect } from "vitest";
import {
  isPathAllowed,
  validateEdits,
  buildHandsScript,
  parseHandsOutput,
  shquote,
  MAX_EDIT_FILES,
  type FileEdit,
} from "./repo-hands";

describe("isPathAllowed", () => {
  it("allows ordinary source paths", () => {
    expect(isPathAllowed("lib/foo.ts")).toBe(true);
    expect(isPathAllowed("app/page.tsx")).toBe(true);
    expect(isPathAllowed("components/x/Y.tsx")).toBe(true);
  });
  it("blocks traversal, absolute and windows paths", () => {
    expect(isPathAllowed("../etc/passwd")).toBe(false);
    expect(isPathAllowed("a/../../b")).toBe(false);
    expect(isPathAllowed("/etc/passwd")).toBe(false);
    expect(isPathAllowed("C:/x")).toBe(false);
    expect(isPathAllowed("")).toBe(false);
  });
  it("blocks secrets, CI, infra and the agent's own safety libs", () => {
    expect(isPathAllowed(".env")).toBe(false);
    expect(isPathAllowed(".env.local")).toBe(false);
    expect(isPathAllowed(".github/workflows/ci.yml")).toBe(false);
    expect(isPathAllowed("vercel.json")).toBe(false);
    expect(isPathAllowed("supabase/schema.sql")).toBe(false);
    expect(isPathAllowed("lib/agent-runtime.ts")).toBe(false);
    expect(isPathAllowed("lib/verifier.ts")).toBe(false);
    expect(isPathAllowed("lib/agent-actions-exec.ts")).toBe(false);
    expect(isPathAllowed("lib/repo-hands.ts")).toBe(false);
  });
});

describe("validateEdits", () => {
  it("accepts a small safe batch", () => {
    const v = validateEdits([{ path: "lib/foo.ts", contents: "export const a = 1;" }]);
    expect(v.ok).toBe(true);
    expect(v.edits).toHaveLength(1);
  });
  it("rejects an empty or non-array input", () => {
    expect(validateEdits([]).ok).toBe(false);
    expect(validateEdits(null).ok).toBe(false);
  });
  it("rejects the whole batch if ANY path is disallowed", () => {
    const v = validateEdits([
      { path: "lib/foo.ts", contents: "ok" },
      { path: ".env", contents: "SECRET=1" },
    ]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/disallowed/);
  });
  it("rejects too many files", () => {
    const many = Array.from({ length: MAX_EDIT_FILES + 1 }, (_, i) => ({
      path: `lib/f${i}.ts`,
      contents: "x",
    }));
    expect(validateEdits(many).ok).toBe(false);
  });
  it("rejects an oversized file", () => {
    const big = "x".repeat(70 * 1024);
    expect(validateEdits([{ path: "lib/big.ts", contents: big }]).ok).toBe(false);
  });
  it("rejects duplicate paths", () => {
    const v = validateEdits([
      { path: "lib/foo.ts", contents: "a" },
      { path: "lib/foo.ts", contents: "b" },
    ]);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/duplicate/);
  });
});

describe("shquote", () => {
  it("wraps and escapes single quotes safely", () => {
    expect(shquote("a'b")).toBe(`'a'\\''b'`);
  });
});

describe("buildHandsScript", () => {
  const edits: FileEdit[] = [{ path: "lib/foo.ts", contents: "export const a = 1;\n" }];
  const script = buildHandsScript({
    repoSlug: "LoopLabsfun/loop",
    branch: "main",
    edits,
    commitMessage: "feat: add a",
    authorName: "loop-agent",
    authorEmail: "agent@agents.looplabs.fun",
  });
  it("clones the right repo and pushes the right branch", () => {
    expect(script).toContain("github.com/LoopLabsfun/loop.git");
    expect(script).toContain("git push origin 'main'");
  });
  it("never embeds the token literally (reads $GITHUB_TOKEN at runtime)", () => {
    expect(script).toContain("${GITHUB_TOKEN}");
  });
  it("runs the gate and only pushes when green", () => {
    expect(script).toContain("npx tsc --noEmit");
    expect(script).toContain("npx vitest run");
    expect(script).toContain('if [ "$GATE_RESULT" != "ok" ]; then echo "PUSHED=no"; exit 0; fi');
  });
  it("writes files via base64 (no shell-escaping hazards)", () => {
    const b64 = Buffer.from(edits[0].contents, "utf8").toString("base64");
    expect(script).toContain(b64);
    expect(script).toContain("base64 -d");
  });
});

describe("parseHandsOutput", () => {
  it("reports a successful push with the sha", () => {
    const r = parseHandsOutput("GATE_RESULT=ok\nPUSHED=yes\nCOMMIT_SHA=abc1234def");
    expect(r.pushed).toBe(true);
    expect(r.gatePassed).toBe(true);
    expect(r.commitSha).toBe("abc1234def");
    expect(r.note).toMatch(/pushed abc1234/);
  });
  it("reports a failed gate (not pushed)", () => {
    const r = parseHandsOutput("GATE_RESULT=fail\nPUSHED=no");
    expect(r.pushed).toBe(false);
    expect(r.gatePassed).toBe(false);
    expect(r.note).toMatch(/gate failed/);
  });
  it("reports no changes", () => {
    const r = parseHandsOutput("GATE_RESULT=ok\nNO_CHANGES\nPUSHED=no");
    expect(r.pushed).toBe(false);
    expect(r.note).toMatch(/no file changes/);
  });
});
