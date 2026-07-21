// Standalone EIP-191 ("personal_sign") signature verification for EVM/Hood
// wallets — the server-side counterpart to Solana's ed25519 proof verification
// (lib/signature.ts), needed so a Hood payout wallet can be linked with the
// same "wallet signs a canonical message, server verifies" pattern used
// everywhere else in this codebase (lib/compute-message.ts, lib/launch-message.ts).
//
// Deliberately NOT ethers/viem (this codebase avoids that chunk-loading chain
// on the client — see lib/chains/hood-wallet.tsx's header comment; here it's
// server-only anyway, but staying dependency-light matters just as much for a
// security-sensitive, easy-to-get-subtly-wrong primitive like signature
// recovery). @noble/curves + @noble/hashes are small, audited, and already
// resolve in this tree transitively — pinned as direct deps so they can't
// silently drift.
import "server-only";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

/** The exact digest an EVM wallet's `personal_sign` produces for `message`
 *  (EIP-191): keccak256("\x19Ethereum Signed Message:\n" + len + message). */
function personalSignDigest(message: string): Uint8Array {
  const msgBytes = new TextEncoder().encode(message);
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msgBytes.length}`);
  const full = new Uint8Array(prefix.length + msgBytes.length);
  full.set(prefix, 0);
  full.set(msgBytes, prefix.length);
  return keccak_256(full);
}

/** Derive the 0x… checksum-agnostic (lowercase) address from an uncompressed
 *  secp256k1 public key (65 bytes, leading 0x04). */
function addressFromUncompressedPubkey(pub: Uint8Array): string {
  const hash = keccak_256(pub.slice(1)); // drop the 0x04 prefix byte
  return "0x" + Buffer.from(hash.slice(-20)).toString("hex");
}

/** Verify a hex `personal_sign` signature (65 bytes: r‖s‖v, v ∈ {0,1,27,28})
 *  over `message` recovers to `expectedAddress`. Never throws — malformed
 *  input (wrong length, bad hex, invalid recovery bit) is just `false`. */
export function verifyEvmPersonalSign(
  message: string,
  signatureHex: string,
  expectedAddress: string
): boolean {
  try {
    const hex = signatureHex.startsWith("0x") ? signatureHex.slice(2) : signatureHex;
    if (!/^[0-9a-fA-F]{130}$/.test(hex)) return false; // 65 bytes
    const bytes = Buffer.from(hex, "hex");
    let v = bytes[64];
    if (v >= 27) v -= 27;
    if (v !== 0 && v !== 1) return false;
    // Wallets emit r‖s‖v (v last); @noble/curves' "recovered" format is the
    // OTHER order, recoveryByte‖r‖s (recovery bit first) — verified empirically
    // against this exact installed version, not assumed from the docs.
    const recovered = new Uint8Array(65);
    recovered[0] = v;
    recovered.set(bytes.subarray(0, 64), 1);
    const digest = personalSignDigest(message);
    const sig = secp256k1.Signature.fromBytes(recovered, "recovered");
    const pub = sig.recoverPublicKey(digest).toBytes(false); // uncompressed, 0x04‑prefixed
    const addr = addressFromUncompressedPubkey(pub);
    return addr.toLowerCase() === expectedAddress.trim().toLowerCase();
  } catch {
    return false;
  }
}
