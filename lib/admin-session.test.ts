import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { base58Encode } from "./base58";
import { buildAdminMessage } from "./admin-message";
import { verifyAdminProof, type LaunchProof } from "./signature";
import { issueAdminToken, verifyAdminToken } from "./admin-session";

const KEY = "test-admin-secret-0123456789";

function signAdmin(projectKey: string, ts: number, kp = nacl.sign.keyPair()): LaunchProof {
  const message = buildAdminMessage(projectKey, ts);
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return { pubkey: base58Encode(kp.publicKey), signature: Buffer.from(sig).toString("base64"), message };
}

describe("verifyAdminProof", () => {
  const now = 1_700_000_000_000;
  it("accepts a genuine, recent proof", () => {
    expect(verifyAdminProof(signAdmin("loop", now), "loop", { now })).toBe(true);
  });
  it("rejects a replayed (stale) proof beyond 5 min", () => {
    const p = signAdmin("loop", now - 6 * 60 * 1000);
    expect(verifyAdminProof(p, "loop", { now })).toBe(false);
  });
  it("rejects a proof for a different project", () => {
    expect(verifyAdminProof(signAdmin("loop", now), "other", { now })).toBe(false);
  });
  it("rejects a tampered message", () => {
    const p = signAdmin("loop", now);
    expect(verifyAdminProof({ ...p, message: p.message + "x" }, "loop", { now })).toBe(false);
  });
  it("rejects a forged signature", () => {
    const p = signAdmin("loop", now);
    const other = nacl.sign.keyPair();
    expect(verifyAdminProof({ ...p, pubkey: base58Encode(other.publicKey) }, "loop", { now })).toBe(false);
  });
});

describe("admin session token", () => {
  const now = 1_700_000_000_000;
  it("round-trips wallet + expiry", () => {
    const t = issueAdminToken("WALLET123", { now, key: KEY })!;
    const claims = verifyAdminToken(t, { now: now + 1000, key: KEY });
    expect(claims?.wallet).toBe("WALLET123");
    expect(claims?.exp).toBe(now + 2 * 60 * 60 * 1000);
  });
  it("rejects a tampered MAC", () => {
    const t = issueAdminToken("WALLET123", { now, key: KEY })!;
    const bad = t.slice(0, -2) + (t.endsWith("aa") ? "bb" : "aa");
    expect(verifyAdminToken(bad, { now, key: KEY })).toBeNull();
  });
  it("rejects a tampered payload (different wallet)", () => {
    const t = issueAdminToken("WALLET123", { now, key: KEY })!;
    const forged = Buffer.from("EVIL:" + (now + 1e7)).toString("base64url") + "." + t.split(".")[1];
    expect(verifyAdminToken(forged, { now, key: KEY })).toBeNull();
  });
  it("rejects an expired token", () => {
    const t = issueAdminToken("WALLET123", { now, ttlMs: 1000, key: KEY })!;
    expect(verifyAdminToken(t, { now: now + 2000, key: KEY })).toBeNull();
  });
  it("rejects a token signed with a different key", () => {
    const t = issueAdminToken("WALLET123", { now, key: KEY })!;
    expect(verifyAdminToken(t, { now, key: "other-key" })).toBeNull();
  });
  it("returns null when no secret is configured", () => {
    expect(issueAdminToken("WALLET123", { now, key: "" })).toBeNull();
    expect(verifyAdminToken("x.y", { now, key: "" })).toBeNull();
  });
});
