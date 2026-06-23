import { describe, it, expect } from "vitest";
import { secretsMatch } from "./api-auth";

describe("secretsMatch", () => {
  it("returns true for identical secrets", () => {
    expect(secretsMatch("s3cr3t-token", "s3cr3t-token")).toBe(true);
    expect(secretsMatch("Bearer abc123", "Bearer abc123")).toBe(true);
  });

  it("returns false for a mismatch (incl. differing length)", () => {
    expect(secretsMatch("s3cr3t-token", "s3cr3t-tokeX")).toBe(false);
    expect(secretsMatch("short", "a-much-longer-secret")).toBe(false);
    expect(secretsMatch("Bearer abc123", "abc123")).toBe(false);
  });

  it("fails closed when either side is missing/empty", () => {
    expect(secretsMatch(null, "expected")).toBe(false);
    expect(secretsMatch(undefined, "expected")).toBe(false);
    expect(secretsMatch("provided", undefined)).toBe(false);
    expect(secretsMatch("", "")).toBe(false);
    expect(secretsMatch("provided", "")).toBe(false);
  });
});
