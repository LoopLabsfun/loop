import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { base58Encode } from "./base58";
import { buildProfileMessage } from "./profile-message";
import { verifyProfileProof, type LaunchProof } from "./signature";

function signProfile(wallet: string, ts: number, kp = nacl.sign.keyPair()): LaunchProof {
  const message = buildProfileMessage(wallet, ts);
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return { pubkey: base58Encode(kp.publicKey), signature: Buffer.from(sig).toString("base64"), message };
}

describe("buildProfileMessage", () => {
  it("uses the looplabs.fun brand namespace (not loop.fun)", () => {
    expect(buildProfileMessage("W", 1)).toBe("looplabs.fun profile\nwallet:W\nts:1");
  });
});

describe("verifyProfileProof", () => {
  const now = 1_700_000_000_000;
  it("accepts a genuine, recent proof for the same wallet", () => {
    const kp = nacl.sign.keyPair();
    const wallet = base58Encode(kp.publicKey);
    expect(verifyProfileProof(signProfile(wallet, now, kp), wallet, { now })).toBe(true);
  });
  it("rejects a replayed (stale) proof beyond 5 min", () => {
    const kp = nacl.sign.keyPair();
    const wallet = base58Encode(kp.publicKey);
    expect(verifyProfileProof(signProfile(wallet, now - 6 * 60 * 1000, kp), wallet, { now })).toBe(false);
  });
  it("rejects a proof minted for a different wallet", () => {
    expect(verifyProfileProof(signProfile("other", now), "wallet", { now })).toBe(false);
  });
  it("rejects a tampered message", () => {
    const kp = nacl.sign.keyPair();
    const wallet = base58Encode(kp.publicKey);
    const p = signProfile(wallet, now, kp);
    expect(verifyProfileProof({ ...p, message: p.message + "x" }, wallet, { now })).toBe(false);
  });
});
