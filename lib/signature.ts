import nacl from "tweetnacl";
import { base58Decode } from "./base58";
import { buildLaunchMessage } from "./launch-message";

// Wallet-signature ownership proof. The launcher signs a canonical message with
// their wallet; the server verifies the ed25519 signature before crediting the
// project to that pubkey (creator_wallet). Pure + dependency-light (tweetnacl
// is CJS) so it runs on the Vercel lambda and is unit-testable.

export interface LaunchProof {
  pubkey: string; // base58
  signature: string; // base64
  message: string;
}

// Re-exported so existing importers keep working.
export { buildLaunchMessage } from "./launch-message";

/** Verify the ed25519 signature of `message` by `pubkey`. */
export function verifyWalletSignature(proof: LaunchProof): boolean {
  try {
    const pub = base58Decode(proof.pubkey);
    const sig = Uint8Array.from(Buffer.from(proof.signature, "base64"));
    const msg = new TextEncoder().encode(proof.message);
    if (pub.length !== 32 || sig.length !== 64) return false;
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}

/**
 * Full check used by the launch action: the signature is valid AND the signed
 * message is the canonical one for this ticker AND it's recent (anti-replay).
 */
export function verifyLaunchProof(
  proof: LaunchProof,
  ticker: string,
  opts: { maxAgeMs?: number; now?: number } = {}
): boolean {
  const maxAgeMs = opts.maxAgeMs ?? 10 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const m = proof.message.match(/\nts:(\d+)$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxAgeMs) return false;
  if (proof.message !== buildLaunchMessage(ticker, ts)) return false;
  return verifyWalletSignature(proof);
}
