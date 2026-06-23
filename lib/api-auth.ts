import { createHash, timingSafeEqual } from "node:crypto";

// Constant-time secret comparison for the shared-secret webhooks (agent
// cron/tick, session-finish, inbound email). A plain `===` short-circuits on the
// first differing byte, so an attacker on the wire can in principle recover the
// secret one byte at a time via response-timing. Comparing fixed-length SHA-256
// digests in constant time removes both the byte-by-byte timing signal AND the
// length signal (a raw timingSafeEqual throws / returns early on length mismatch).
//
// node:crypto only — every caller route already pins `runtime = "nodejs"`.

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/**
 * True iff `provided` equals `expected`, compared in constant time. Returns false
 * (never throws) when either side is missing/empty, so callers can use it directly
 * as the auth guard — an unset server secret therefore fails closed.
 */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!provided || !expected) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}
