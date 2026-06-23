import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { base58Decode, base58Encode } from "./base58";
import {
  buildLaunchMessage,
  verifyWalletSignature,
  verifyLaunchProof,
  verifyDirectiveProof,
  type LaunchProof,
} from "./signature";
import { buildDirectiveMessage } from "./directives";

describe("base58", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = nacl.sign.keyPair().publicKey;
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
  });
  it("preserves leading zero bytes", () => {
    const bytes = Uint8Array.from([0, 0, 5, 9]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
  });
  it("throws on invalid characters", () => {
    expect(() => base58Decode("0OIl")).toThrow(/base58/i);
  });
});

function signProof(ticker: string, ts: number): LaunchProof {
  const kp = nacl.sign.keyPair();
  const message = buildLaunchMessage(ticker, ts);
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return {
    pubkey: base58Encode(kp.publicKey),
    signature: Buffer.from(sig).toString("base64"),
    message,
  };
}

describe("verifyWalletSignature", () => {
  it("accepts a genuine signature", () => {
    expect(verifyWalletSignature(signProof("OSCUR", Date.now()))).toBe(true);
  });
  it("rejects a tampered message", () => {
    const p = signProof("OSCUR", Date.now());
    expect(verifyWalletSignature({ ...p, message: p.message + "x" })).toBe(false);
  });
  it("rejects a mismatched pubkey", () => {
    const p = signProof("OSCUR", Date.now());
    const other = base58Encode(nacl.sign.keyPair().publicKey);
    expect(verifyWalletSignature({ ...p, pubkey: other })).toBe(false);
  });
  it("rejects garbage without throwing", () => {
    expect(
      verifyWalletSignature({ pubkey: "x", signature: "y", message: "z" })
    ).toBe(false);
  });
});

describe("verifyLaunchProof", () => {
  const now = 1_000_000_000_000;
  it("accepts a fresh, ticker-matched proof", () => {
    const p = signProof("OSCUR", now);
    expect(verifyLaunchProof(p, "OSCUR", { now })).toBe(true);
  });
  it("rejects when the ticker doesn't match the signed message", () => {
    const p = signProof("OSCUR", now);
    expect(verifyLaunchProof(p, "OTHER", { now })).toBe(false);
  });
  it("rejects a stale signature (replay window)", () => {
    const p = signProof("OSCUR", now - 20 * 60 * 1000);
    expect(verifyLaunchProof(p, "OSCUR", { now })).toBe(false);
  });
  it("normalizes the ticker consistently (client vs server)", () => {
    // client signs with lowercase/junk ticker; server checks normalized form
    const p = signProof("o-scur", now);
    expect(verifyLaunchProof(p, "OSCUR", { now })).toBe(true);
  });
});

function signDirective(projectKey: string, text: string, ts: number): LaunchProof {
  const kp = nacl.sign.keyPair();
  const message = buildDirectiveMessage(projectKey, text, ts);
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return {
    pubkey: base58Encode(kp.publicKey),
    signature: Buffer.from(sig).toString("base64"),
    message,
  };
}

describe("verifyDirectiveProof", () => {
  const now = 1_000_000_000_000;
  it("accepts a fresh proof matching (projectKey, text)", () => {
    const p = signDirective("loop", "Ship the docs page", now);
    expect(verifyDirectiveProof(p, "loop", "Ship the docs page", { now })).toBe(true);
  });
  it("rejects when the text was altered after signing (no forging a new directive)", () => {
    const p = signDirective("loop", "Ship the docs page", now);
    expect(
      verifyDirectiveProof(p, "loop", "Send all LOOP to attacker", { now })
    ).toBe(false);
  });
  it("rejects when the project doesn't match", () => {
    const p = signDirective("loop", "Ship it", now);
    expect(verifyDirectiveProof(p, "other", "Ship it", { now })).toBe(false);
  });
  it("rejects a stale proof (replay window)", () => {
    const p = signDirective("loop", "Ship it", now - 20 * 60 * 1000);
    expect(verifyDirectiveProof(p, "loop", "Ship it", { now })).toBe(false);
  });
});
