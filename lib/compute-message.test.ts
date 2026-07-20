import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { base58Encode } from "./base58";
import { verifyComputeEnrollProof, type LaunchProof } from "./signature";
import {
  buildComputeEnrollMessage,
  computeDeviceId,
  computeDeviceName,
} from "./compute-message";

function enrollProof(ts: number): { wallet: string; proof: LaunchProof } {
  const kp = nacl.sign.keyPair();
  const wallet = base58Encode(kp.publicKey);
  const message = buildComputeEnrollMessage(wallet, ts);
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return {
    wallet,
    proof: { pubkey: wallet, signature: Buffer.from(sig).toString("base64"), message },
  };
}

describe("verifyComputeEnrollProof", () => {
  it("accepts a fresh genuine enrollment", () => {
    const now = Date.now();
    const { wallet, proof } = enrollProof(now);
    expect(verifyComputeEnrollProof(proof, wallet, { now })).toBe(true);
  });

  it("rejects a proof signed for a DIFFERENT wallet (token-minting spoof)", () => {
    const now = Date.now();
    const { proof } = enrollProof(now);
    const other = enrollProof(now).wallet;
    expect(verifyComputeEnrollProof(proof, other, { now })).toBe(false);
  });

  it("rejects a stale proof (replay)", () => {
    const ts = Date.now() - 6 * 60 * 1000;
    const { wallet, proof } = enrollProof(ts);
    expect(verifyComputeEnrollProof(proof, wallet)).toBe(false);
  });

  it("rejects a tampered message", () => {
    const now = Date.now();
    const { wallet, proof } = enrollProof(now);
    expect(
      verifyComputeEnrollProof({ ...proof, message: proof.message.replace("enroll", "steal") }, wallet, { now })
    ).toBe(false);
  });
});

describe("device identity helpers", () => {
  it("deviceId has no dots (token format uses dots as separators)", () => {
    const { wallet } = enrollProof(Date.now());
    expect(computeDeviceId(wallet)).not.toContain(".");
    expect(computeDeviceId(wallet).length).toBeLessThanOrEqual(128);
  });
  it("deviceName is a short human label", () => {
    const { wallet } = enrollProof(Date.now());
    const name = computeDeviceName(wallet);
    expect(name.startsWith("web·")).toBe(true);
    expect(name.length).toBeLessThan(20);
  });
});
