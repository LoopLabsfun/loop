import { describe, it, expect } from "vitest";
import { buildSdkHandsScript, denyDiffRegex } from "./agent-sdk-hands";
import { DENY_PATH_PREFIXES } from "./repo-hands";

const base = {
  repoSlug: "LoopLabsfun/loop",
  branch: "main",
  commitMessage: "feat(agent): a thing",
  authorName: "loop-agent",
  authorEmail: "agent@looplabs.fun",
};

describe("denyDiffRegex", () => {
  it("anchors and escapes the shared denylist (single source of truth)", () => {
    const re = denyDiffRegex();
    expect(re.startsWith("^(")).toBe(true);
    // dots are escaped so "lib/agent-runtime." can't match "lib/agent-runtimeX"
    expect(re).toContain("lib/agent-runtime\\.");
    // every shared prefix is represented
    for (const p of DENY_PATH_PREFIXES) {
      expect(re).toContain(p.replace(/\./g, "\\."));
    }
  });
  it("compiles to a regex that blocks guarded paths but allows normal ones", () => {
    const rx = new RegExp(denyDiffRegex(), "i");
    expect(rx.test("lib/agent-runtime.ts")).toBe(true);
    expect(rx.test("lib/agent-sdk-hands.ts")).toBe(true);
    expect(rx.test(".github/workflows/ci.yml")).toBe(true);
    expect(rx.test("vercel.json")).toBe(true);
    expect(rx.test("lib/token-math.ts")).toBe(false);
    expect(rx.test("components/token/TokenPage.tsx")).toBe(false);
  });
});

describe("buildSdkHandsScript", () => {
  const script = buildSdkHandsScript(base);

  it("withholds the GitHub token from the session (captured, unset, before the run)", () => {
    const idxCapture = script.indexOf('GH="${GITHUB_TOKEN:-}"');
    const idxUnset = script.indexOf("unset GITHUB_TOKEN");
    const idxSession = script.indexOf("agent-sdk-session.mjs");
    expect(idxCapture).toBeGreaterThanOrEqual(0);
    expect(idxUnset).toBeGreaterThan(idxCapture);
    expect(idxSession).toBeGreaterThan(idxUnset); // session runs AFTER the token is removed
  });
  it("uses the captured token (\\${GH}) for clone + push, never the raw env var there", () => {
    expect(script).toContain('git clone --depth 20 --branch \'main\' "https://x-access-token:${GH}@github.com/LoopLabsfun/loop.git"');
    expect(script).toContain('git push "https://x-access-token:${GH}@github.com/LoopLabsfun/loop.git" \'main\'');
  });
  it("clones onto the root disk, not the /tmp tmpfs", () => {
    expect(script).toContain('cd "${HOME:-/home/user}"');
    expect(script).not.toMatch(/clone[^\n]*\/tmp/);
  });
  it("denylist-checks the diff BEFORE the gate", () => {
    const idxDeny = script.indexOf("DENYLIST_HIT");
    const idxGate = script.indexOf("npx tsc --noEmit");
    expect(idxDeny).toBeGreaterThanOrEqual(0);
    expect(idxGate).toBeGreaterThan(idxDeny);
    expect(script).toContain("git -C \"$PWD\" diff --name-only");
  });
  it("runs the independent gate and emits the repo-hands markers", () => {
    expect(script).toContain("npx tsc --noEmit");
    expect(script).toContain("npx vitest run");
    expect(script).toContain('echo "GATE_RESULT=$GATE_RESULT"');
    expect(script).toContain('echo "PUSHED=yes"');
    expect(script).toContain("COMMIT_SHA=$(git rev-parse HEAD)");
  });
  it("omits `next build` unless fullGate", () => {
    expect(script).not.toContain("npx next build");
    expect(buildSdkHandsScript({ ...base, fullGate: true })).toContain("npx next build");
  });
  it("dryRun stops after the gate and never pushes", () => {
    const dry = buildSdkHandsScript({ ...base, dryRun: true });
    expect(dry).toContain("DRY_RUN=1");
    expect(dry).not.toContain("git push");
    expect(dry).not.toContain("git commit");
  });
});
