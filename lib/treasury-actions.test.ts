import { describe, it, expect, afterEach } from "vitest";
import { previewClaim, SWEEP_BUFFER_LAMPORTS } from "./treasury-actions";

const orig = process.env.LAUNCH_SIGNER_SECRET;
afterEach(() => {
  if (orig === undefined) delete process.env.LAUNCH_SIGNER_SECRET;
  else process.env.LAUNCH_SIGNER_SECRET = orig;
});

describe("previewClaim", () => {
  it("is disarmed when no launch signer is configured", () => {
    delete process.env.LAUNCH_SIGNER_SECRET;
    const p = previewClaim();
    expect(p.op).toBe("claim");
    expect(p.armed).toBe(false);
    expect(p.mainnetOnly).toBe(true);
    expect(p.note).toMatch(/not set|disabled/i);
  });

  it("is armed when the launch signer is set", () => {
    process.env.LAUNCH_SIGNER_SECRET = "[1,2,3]";
    const p = previewClaim();
    expect(p.armed).toBe(true);
    expect(p.note).toMatch(/creator fees/i);
  });
});

describe("SWEEP_BUFFER_LAMPORTS", () => {
  it("leaves a positive rent+fee buffer", () => {
    expect(SWEEP_BUFFER_LAMPORTS).toBeGreaterThan(0);
  });
});
