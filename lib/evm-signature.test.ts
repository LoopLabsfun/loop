import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { verifyEvmPersonalSign } from "./evm-signature";

// Sign a message the SAME way a real wallet's `personal_sign` does (EIP-191),
// with a known private key, so the test exercises the real recover path —
// not a mocked one. This is what makes the round-trip a meaningful check on
// security-sensitive code, not just a tautology.
function signPersonal(message: string, privateKey: Uint8Array): string {
  const msgBytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msgBytes.length}`);
  const full = new Uint8Array(prefix.length + msgBytes.length);
  full.set(prefix, 0);
  full.set(msgBytes, prefix.length);
  const digest = keccak_256(full);
  const sig = secp256k1.sign(digest, privateKey);
  const bytes = sig.toBytes("recovered"); // @noble's order: recoveryBit‖r‖s
  const wire = new Uint8Array(65); // real wallets emit r‖s‖v (v ∈ {27,28})
  wire.set(bytes.subarray(1, 65), 0);
  wire[64] = bytes[0] + 27;
  return "0x" + Buffer.from(wire).toString("hex");
}

function addressOf(privateKey: Uint8Array): string {
  const pub = secp256k1.getPublicKey(privateKey, false); // uncompressed
  const hash = keccak_256(pub.slice(1));
  return "0x" + Buffer.from(hash.slice(-20)).toString("hex");
}

const PRIV_A = new Uint8Array(32).fill(1);
const PRIV_B = new Uint8Array(32).fill(2);

describe("verifyEvmPersonalSign", () => {
  it("accepts a genuine signature from the claimed address", () => {
    const msg = "loop.fun compute\nlink hood payout for wallet:abc\nevm:0xdead\nts:1234";
    const sig = signPersonal(msg, PRIV_A);
    expect(verifyEvmPersonalSign(msg, sig, addressOf(PRIV_A))).toBe(true);
  });

  it("rejects a signature from a DIFFERENT wallet claiming someone else's address", () => {
    const msg = "loop.fun compute\nlink hood payout for wallet:abc\nevm:0xdead\nts:1234";
    const sig = signPersonal(msg, PRIV_B);
    expect(verifyEvmPersonalSign(msg, sig, addressOf(PRIV_A))).toBe(false);
  });

  it("rejects a genuine signature over a TAMPERED message", () => {
    const msg = "loop.fun compute\nlink hood payout for wallet:abc\nevm:0xdead\nts:1234";
    const sig = signPersonal(msg, PRIV_A);
    expect(verifyEvmPersonalSign(msg + " ", sig, addressOf(PRIV_A))).toBe(false);
  });

  it("never throws on malformed signatures", () => {
    expect(verifyEvmPersonalSign("hi", "0xnothex", "0x0000000000000000000000000000000000dead")).toBe(false);
    expect(verifyEvmPersonalSign("hi", "0x1234", "0x0000000000000000000000000000000000dead")).toBe(false);
    expect(verifyEvmPersonalSign("hi", "", "0x0000000000000000000000000000000000dead")).toBe(false);
  });
});
