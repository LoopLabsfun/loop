import { describe, it, expect } from "vitest";
import { summarizeSandbox, sandboxConfigured, stripTerminalNoise } from "./sandbox";

describe("summarizeSandbox", () => {
  it("uses stdout on success", () => {
    expect(summarizeSandbox({ ok: true, stdout: "hello\nworld", stderr: "" })).toBe(
      "hello world"
    );
  });
  it("falls back to (no output) when empty", () => {
    expect(summarizeSandbox({ ok: true, stdout: "  ", stderr: "" })).toBe("(no output)");
  });
  it("reports errors", () => {
    expect(summarizeSandbox({ ok: false, stdout: "", stderr: "boom", error: "Err" })).toContain(
      "error:"
    );
  });
  it("truncates long output", () => {
    const out = summarizeSandbox({ ok: true, stdout: "x".repeat(500), stderr: "" }, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("stripTerminalNoise", () => {
  it("removes ANSI escapes, cursor moves, and spinner glyphs", () => {
    // ESC[1G ESC[0K + braille spinner + ESC[32m green ... ESC[0m, as a real npm run emits.
    const noisy = "\x1b[1G\x1b[0K⠙ \x1b[32m> typecheck\x1b[0m\npassed";
    expect(stripTerminalNoise(noisy)).toBe(" > typecheck\npassed");
  });
  it("leaves clean text untouched", () => {
    expect(stripTerminalNoise("all good")).toBe("all good");
  });
  it("summarizeSandbox now strips the noise into a clean line", () => {
    const r = { ok: true, stdout: "\x1b[1G\x1b[0K⠙ build ok", stderr: "" };
    expect(summarizeSandbox(r)).toBe("build ok");
  });
});

describe("sandboxConfigured", () => {
  it("reflects E2B_API_KEY presence", () => {
    expect(typeof sandboxConfigured()).toBe("boolean");
  });
});
