// Input guards for the PUBLIC, unauthenticated proxy routes (/api/swap,
// /api/market). Those routes forward to free third-party APIs (PumpPortal,
// DexScreener, GeckoTerminal) on the server's behalf. Without validation a caller
// could vary the parameters to bypass the in-process memo and make OUR server
// hammer those upstreams — getting our shared IP rate-limited (a DoS-amplification
// vector that surfaces to real users as empty charts / failed swaps). Rejecting
// malformed addresses and bounding numeric params closes that, cheaply, before a
// single outbound request is made.

/** A Solana address / mint: base58 (Bitcoin alphabet — no 0 O I l), 32–44 chars. */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** True only for a well-formed Solana base58 address — the cheap pre-fetch gate. */
export function isSolanaAddress(s: unknown): s is string {
  return typeof s === "string" && BASE58_ADDRESS.test(s);
}

/**
 * Coerce a user-supplied amount to a positive, finite number within (0, max],
 * or null if it can't be (NaN, ≤0, ±Infinity, over the cap). Accepts string or
 * number — the swap body allows both. The cap stops a caller from forwarding an
 * absurd value to the upstream trade builder.
 */
export function parseAmount(v: unknown, max = 1_000_000): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > max) return null;
  return n;
}

/** Clamp a slippage percent to a sane [0, 100]; fall back to `dflt` on garbage. */
export function clampSlippage(v: unknown, dflt = 10): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return dflt;
  return Math.min(100, Math.max(0, n));
}
