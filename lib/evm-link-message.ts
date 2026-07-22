// Canonical message an EVM wallet signs to attach itself to a Loop profile.
//
// WHY A SECOND SIGNATURE AT ALL. The Solana signature already proves who the
// user is. This one proves something different and just as important: that the
// EVM address they typed is an address they can actually SIGN FOR. Without it,
// a pasted exchange deposit address, or a single mistyped character, is accepted
// silently and only discovered when funds sent there are unrecoverable. A
// `personal_sign` costs the user nothing — no transaction, no gas — and makes
// that whole class of loss impossible.
//
// The message BINDS the EVM address to the Solana wallet, so a signature
// harvested elsewhere can't be replayed to point someone else's profile at the
// attacker's address, plus a timestamp so an old one can't be reused.
//
// BRAND: a NEW namespace, shown to the user in their wallet ⇒ `looplabs.fun`,
// not the legacy `loop.fun` namespaces (which stay as-is only because changing
// them would invalidate already-issued signatures).
//
// Pure + dependency-free so the client (to sign) and the server (to verify)
// share it verbatim and can never drift.

/** How long an EVM link proof stays valid. Same 5-minute window as the profile
 *  proof — long enough for a wallet popup, short enough that a leaked signature
 *  is worthless. */
export const EVM_LINK_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Sign-in from the EVM side. A SEPARATE namespace from the link message on
 * purpose: a signature collected for one action must never authorize the other.
 * Linking says "this address is mine"; signing in says "let me act as the Loop
 * identity this address is already linked to" — and if they shared a namespace,
 * a link signature harvested from a log or a support screenshot would be a
 * ready-made session token.
 *
 * Note there is no Solana wallet in this message: the signer doesn't know it
 * yet. The server resolves it from the proven link, which is what makes the
 * EVM address a *credential for* an identity rather than an identity itself.
 */
export function buildEvmSignInMessage(evmAddress: string, ts: number): string {
  return `looplabs.fun sign in\nevm:${evmAddress.toLowerCase()}\nts:${ts}`;
}

export function buildEvmLinkMessage(wallet: string, evmAddress: string, ts: number): string {
  // Lowercased so the signed text can't differ from the stored value by
  // checksum casing alone (wallets render EIP-55 mixed case; users paste both).
  return `looplabs.fun link evm\nwallet:${wallet}\nevm:${evmAddress.toLowerCase()}\nts:${ts}`;
}

/** A 0x-prefixed 20-byte address. Case-insensitive; EIP-55 checksums are not
 *  required (we normalize) but a malformed address is rejected outright. */
export function isEvmAddress(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v.trim());
}

/** Storage form: lowercase, trimmed. One canonical spelling per address, so a
 *  profile can't be linked twice to "the same" address in two casings. */
export function normalizeEvmAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** Is this link proof recent enough to accept? */
export function isFreshLinkTs(ts: number, now: number = Date.now()): boolean {
  if (!Number.isFinite(ts)) return false;
  const age = now - ts;
  // Reject the future beyond a small clock-skew allowance, and anything stale.
  return age >= -60_000 && age <= EVM_LINK_MAX_AGE_MS;
}

/** Everything that must hold for an EVM sign-in proof, minus the cryptography.
 *  Same shape checks as a link proof, but the message carries no Solana wallet
 *  (the server resolves it), so it is validated against its own namespace. */
export function signInProofProblems(
  proof: EvmLinkProof,
  message: string,
  now: number = Date.now()
): string | null {
  if (!isEvmAddress(proof.address)) return "invalid EVM address";
  if (typeof proof.signature !== "string" || !proof.signature) return "missing signature";
  if (!isFreshLinkTs(proof.ts, now)) return "proof expired — sign again";
  if (message !== buildEvmSignInMessage(proof.address, proof.ts)) {
    return "signed message does not match this address";
  }
  return null;
}

export interface EvmLinkProof {
  address: string;
  signature: string;
  ts: number;
}

/**
 * Everything that must hold for a link to be accepted, EXCEPT the cryptography
 * (which needs a verifier the browser shouldn't carry). Kept pure so the rules
 * are testable on their own: shape, freshness, and that the signed message is
 * the one we would have built — never a message the caller chose.
 */
export function linkProofProblems(
  wallet: string,
  proof: EvmLinkProof,
  message: string,
  now: number = Date.now()
): string | null {
  if (!isEvmAddress(proof.address)) return "invalid EVM address";
  if (typeof proof.signature !== "string" || !proof.signature) return "missing signature";
  if (!isFreshLinkTs(proof.ts, now)) return "proof expired — sign again";
  if (message !== buildEvmLinkMessage(wallet, proof.address, proof.ts)) {
    return "signed message does not match this wallet and address";
  }
  return null;
}
