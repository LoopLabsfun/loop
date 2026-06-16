import { describe, it, expect, afterEach } from "vitest";
import {
  buildCollectCreatorFeePayload,
  collectCreatorFees,
  shouldEscalateClaim,
  MAX_CLAIM_FAILURES,
} from "./creator-fees";

afterEach(() => {
  delete process.env.LAUNCH_SIGNER_SECRET;
});

describe("buildCollectCreatorFeePayload", () => {
  it("builds the collectCreatorFee trade-local payload with a default priority fee", () => {
    expect(buildCollectCreatorFeePayload({ publicKey: "PUBKEY" })).toEqual({
      publicKey: "PUBKEY",
      action: "collectCreatorFee",
      priorityFee: 0.000005,
    });
  });
  it("honors an explicit priority fee", () => {
    expect(
      buildCollectCreatorFeePayload({ publicKey: "X", priorityFee: 0.001 }).priorityFee
    ).toBe(0.001);
  });
});

describe("collectCreatorFees (early returns, no chain)", () => {
  it("refuses on a non-mainnet cluster", async () => {
    const r = await collectCreatorFees("devnet");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mainnet-only/);
  });
  it("no-ops (skipped) when no creator wallet is configured", async () => {
    delete process.env.LAUNCH_SIGNER_SECRET;
    expect(await collectCreatorFees("mainnet")).toEqual({ ok: false, skipped: true });
  });
  it("rejects a malformed signer secret", async () => {
    process.env.LAUNCH_SIGNER_SECRET = "not-a-json-array";
    const r = await collectCreatorFees("mainnet");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/64-byte JSON array/);
  });
});

describe("shouldEscalateClaim (manual guardrail)", () => {
  it("escalates only at/after the failure threshold", () => {
    expect(shouldEscalateClaim(0)).toBe(false);
    expect(shouldEscalateClaim(MAX_CLAIM_FAILURES - 1)).toBe(false);
    expect(shouldEscalateClaim(MAX_CLAIM_FAILURES)).toBe(true);
    expect(shouldEscalateClaim(MAX_CLAIM_FAILURES + 5)).toBe(true);
  });
});
