import { describe, it, expect } from "vitest";
import { summarizeSandbox, sandboxConfigured } from "./sandbox";

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

describe("sandboxConfigured", () => {
  it("reflects E2B_API_KEY presence", () => {
    expect(typeof sandboxConfigured()).toBe("boolean");
  });
});
