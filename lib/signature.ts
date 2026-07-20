import nacl from "tweetnacl";
import { base58Decode } from "./base58";
import { buildLaunchMessage } from "./launch-message";
import { buildDirectiveMessage } from "./directives";
import { buildChatMessage } from "./chat";
import { buildStakeMessage } from "./staking";
import { buildAdminMessage } from "./admin-message";
import { buildProfileMessage } from "./profile-message";
import { buildWaitlistMessage } from "./waitlist-message";
import { buildComputeEnrollMessage } from "./compute-message";

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

/**
 * Full check for authoring a directive: the ed25519 signature is valid AND the
 * signed message is the canonical one for this (projectKey, text) AND it's recent
 * (anti-replay). Only on success may the server record `proof.pubkey` as the
 * verified author — without it, an `author_wallet` is an unproven, untrusted
 * claim (and is dropped). Mirrors verifyLaunchProof.
 */
export function verifyDirectiveProof(
  proof: LaunchProof,
  projectKey: string,
  text: string,
  opts: { maxAgeMs?: number; now?: number } = {}
): boolean {
  const maxAgeMs = opts.maxAgeMs ?? 10 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const m = proof.message.match(/\nts:(\d+)$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxAgeMs) return false;
  if (proof.message !== buildDirectiveMessage(projectKey, text, ts)) return false;
  return verifyWalletSignature(proof);
}

/**
 * Full check for authoring a (stake-gated, unpaid) chat question: valid ed25519
 * signature of the canonical (projectKey, question) message, and recent. Replaces
 * the on-chain payment as the spam gate — the wallet must also have an active
 * stake (checked separately by the caller). Mirrors verifyDirectiveProof.
 */
export function verifyChatProof(
  proof: LaunchProof,
  projectKey: string,
  question: string,
  opts: { maxAgeMs?: number; now?: number } = {}
): boolean {
  const maxAgeMs = opts.maxAgeMs ?? 10 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const m = proof.message.match(/\nts:(\d+)$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxAgeMs) return false;
  if (proof.message !== buildChatMessage(projectKey, question, ts)) return false;
  return verifyWalletSignature(proof);
}

/**
 * Full check for a stake commitment: valid ed25519 signature of the canonical
 * (projectKey, amount) message, and recent. Only on success may the server record
 * a `stakes` row crediting `proof.pubkey`. Mirrors verifyDirectiveProof.
 */
export function verifyStakeProof(
  proof: LaunchProof,
  projectKey: string,
  amount: number,
  opts: { maxAgeMs?: number; now?: number } = {}
): boolean {
  const maxAgeMs = opts.maxAgeMs ?? 10 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const m = proof.message.match(/\nts:(\d+)$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxAgeMs) return false;
  if (proof.message !== buildStakeMessage(projectKey, amount, ts)) return false;
  return verifyWalletSignature(proof);
}

/**
 * Full check for opening a FOUNDER admin session: valid ed25519 signature of the
 * canonical (projectKey) admin message, and recent (anti-replay). The caller MUST
 * additionally check `proof.pubkey === project.creatorWallet` — this verifies the
 * signature is genuine, not that the signer is the founder. Mirrors
 * verifyDirectiveProof. maxAge is tighter (5 min) since this gates agent controls.
 */
export function verifyAdminProof(
  proof: LaunchProof,
  projectKey: string,
  opts: { maxAgeMs?: number; now?: number } = {}
): boolean {
  const maxAgeMs = opts.maxAgeMs ?? 5 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const m = proof.message.match(/\nts:(\d+)$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxAgeMs) return false;
  if (proof.message !== buildAdminMessage(projectKey, ts)) return false;
  return verifyWalletSignature(proof);
}

/**
 * Full check for editing a user PROFILE: valid ed25519 signature of the canonical
 * (wallet) profile message, and recent (anti-replay). The caller MUST also check
 * `proof.pubkey === wallet` — this verifies the signature is genuine, not that the
 * signer owns the profile being edited. Mirrors verifyAdminProof (5-min window).
 */
export function verifyProfileProof(
  proof: LaunchProof,
  wallet: string,
  opts: { maxAgeMs?: number; now?: number } = {}
): boolean {
  const maxAgeMs = opts.maxAgeMs ?? 5 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const m = proof.message.match(/\nts:(\d+)$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxAgeMs) return false;
  if (proof.message !== buildProfileMessage(wallet, ts)) return false;
  return verifyWalletSignature(proof);
}

/**
 * Full check for a WAITLIST pre-launch submit: valid ed25519 signature of the
 * canonical (wallet) waitlist message, and recent (anti-replay). The caller MUST
 * also check `proof.pubkey === wallet` — this verifies the signature is genuine,
 * not that the signer owns the wallet the draft is tied to. Mirrors
 * verifyProfileProof (5-min window). Signing in IS creating the account.
 */
/**
 * Full check for enrolling a COMPUTE device: valid ed25519 signature of the
 * canonical (wallet) compute-enroll message, and recent (anti-replay). The
 * caller MUST also check `proof.pubkey === wallet` before issuing a device
 * token bound to that wallet. Mirrors verifyProfileProof (5-min window).
 */
export function verifyComputeEnrollProof(
  proof: LaunchProof,
  wallet: string,
  opts: { maxAgeMs?: number; now?: number } = {}
): boolean {
  const maxAgeMs = opts.maxAgeMs ?? 5 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const m = proof.message.match(/\nts:(\d+)$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxAgeMs) return false;
  if (proof.message !== buildComputeEnrollMessage(wallet, ts)) return false;
  return verifyWalletSignature(proof);
}

export function verifyWaitlistProof(
  proof: LaunchProof,
  wallet: string,
  opts: { maxAgeMs?: number; now?: number } = {}
): boolean {
  const maxAgeMs = opts.maxAgeMs ?? 5 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const m = proof.message.match(/\nts:(\d+)$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > maxAgeMs) return false;
  if (proof.message !== buildWaitlistMessage(wallet, ts)) return false;
  return verifyWalletSignature(proof);
}
