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
  it("clones onto the root disk ($HOME), never the /tmp tmpfs (ENOSPC guard)", () => {
    // node_modules (~2.3G) overflows the E2B /tmp tmpfs (~2G); must clone on root.
    expect(script).toContain('cd "${HOME:-/home/user}"');
    expect(script).not.toContain("cd /tmp\n");
    expect(script).not.toMatch(/clone[^\n]*\/tmp\/work/);
  });
  it("sets the git identity right after the clone, before the writes/commit", () => {
    // Regression guard: identity must be in place for EVERY git op (rebase,
    // commit), not only the final commit — set it early, once.
    const idxConfig = script.indexOf("git config user.email");
    const idxWrite = script.indexOf("base64 -d"); // the file writes
    const idxCommit = script.indexOf("git commit");
    expect(idxConfig).toBeGreaterThanOrEqual(0);
    expect(idxWrite).toBeGreaterThan(idxConfig);
    expect(idxCommit).toBeGreaterThan(idxConfig);
  });
  it("clones with enough depth for the pre-push rebase", () => {
    expect(script).toContain("git clone --depth 20");
    expect(script).not.toContain("git clone --depth 1 ");
  });
  it("keeps gate output off stdout so markers aren't dropped by the kernel", () => {
    // Verbose npm/vitest output → log file; only markers + a tail reach stdout.
    expect(script).toContain(">> /tmp/gate.log 2>&1");
    expect(script).toContain("tail -n 25 /tmp/gate.log");
  });
  it("omits `next build` unless fullGate is set", () => {
    expect(script).not.toContain("npx next build");
    const full = buildHandsScript({
      repoSlug: "LoopLabsfun/loop",
      branch: "main",
      edits,
      commitMessage: "feat: add a",
      authorName: "loop-agent",
      authorEmail: "agent@agents.looplabs.fun",
      fullGate: true,
    });
    expect(full).toContain("npx next build");
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
  it("parses the CHANGED_FILES marker into a path list (for the altitude check)", () => {
    const r = parseHandsOutput("CHANGED_FILES=components/X.tsx,lib/market.ts,\nGATE_RESULT=ok\nPUSHED=yes\nCOMMIT_SHA=abc1234");
    expect(r.changedFiles).toEqual(["components/X.tsx", "lib/market.ts"]);
  });
  it("defaults changedFiles to [] when the marker is absent", () => {
    expect(parseHandsOutput("GATE_RESULT=ok\nPUSHED=yes\nCOMMIT_SHA=abc1234").changedFiles).toEqual([]);
  });
  it("reports no changes", () => {
    const r = parseHandsOutput("GATE_RESULT=ok\nNO_CHANGES\nPUSHED=no");
    expect(r.pushed).toBe(false);
    expect(r.note).toMatch(/no file changes/);
    expect(r.sessionError).toBe(false);
    expect(r.creditExhausted).toBe(false);
  });
  it("flags Anthropic credit exhaustion above the misleading NO_CHANGES note", () => {
    const r = parseHandsOutput(
      "SESSION_RESULT=error\nSESSION_NOTE=Claude Code returned an error result: Credit balance is too low\nNO_CHANGES\nPUSHED=no"
    );
    expect(r.pushed).toBe(false);
    expect(r.sessionError).toBe(true);
    expect(r.creditExhausted).toBe(true);
    expect(r.note).toMatch(/credit exhausted/i);
  });
  it("flags a generic session error/timeout with its note", () => {
    const r = parseHandsOutput("SESSION_RESULT=error_or_timeout\nNO_CHANGES\nPUSHED=no");
    expect(r.sessionError).toBe(true);
    expect(r.creditExhausted).toBe(false);
    expect(r.note).toMatch(/session errored/i);
  });
  it("does NOT treat a clean SESSION_RESULT=ok no-op as a session error", () => {
    const r = parseHandsOutput("SESSION_RESULT=ok\nGATE_RESULT=ok\nNO_CHANGES\nPUSHED=no");
    expect(r.sessionError).toBe(false);
    expect(r.note).toMatch(/no file changes/);
  });
  it("does NOT flag a session error when the session shipped (pushed)", () => {
    const r = parseHandsOutput(
      "SESSION_RESULT=error\nGATE_RESULT=ok\nPUSHED=yes\nCOMMIT_SHA=abc1234def"
    );
    expect(r.pushed).toBe(true);
    expect(r.sessionError).toBe(false);
    expect(r.note).toMatch(/pushed abc1234/);
  });
  it("legacy repo-hands output (no SESSION_RESULT) never reports a session error", () => {
    const r = parseHandsOutput("GATE_RESULT=fail\nPUSHED=no");
    expect(r.sessionError).toBe(false);
    expect(r.creditExhausted).toBe(false);
  });
  it("parses the session's billed cost from SESSION_COST_USD", () => {
    const r = parseHandsOutput(
      "SESSION_TURNS=7\nSESSION_RESULT=ok\nSESSION_COST_USD=0.184210\nGATE_RESULT=ok\nPUSHED=yes\nCOMMIT_SHA=abc1234def"
    );
    expect(r.costUsd).toBeCloseTo(0.18421, 5);
  });
  it("defaults costUsd to 0 when no cost marker is present (legacy / hard timeout)", () => {
    expect(parseHandsOutput("GATE_RESULT=ok\nPUSHED=yes\nCOMMIT_SHA=abc1234def").costUsd).toBe(0);
    expect(parseHandsOutput("SESSION_RESULT=error_or_timeout\nPUSHED=no").costUsd).toBe(0);
  });
  it("records cost even on a clean session error (billed before failing)", () => {
    const r = parseHandsOutput(
      "SESSION_RESULT=error\nSESSION_NOTE=some failure\nSESSION_COST_USD=0.05\nNO_CHANGES\nPUSHED=no"
    );
    expect(r.sessionError).toBe(true);
    expect(r.costUsd).toBeCloseTo(0.05, 5);
  });
});
