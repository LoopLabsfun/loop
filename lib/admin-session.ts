import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Founder admin SESSION token. The wallet-signature proof (verifyAdminProof +
// pubkey===creatorWallet) is checked ONCE at /api/admin/session; on success we
// mint this short-lived HMAC token and set it as an httpOnly cookie so the live
// log can poll without a wallet popup every 15s. Each admin request re-verifies
// the token (HMAC + expiry) — stateless, no DB session table.
//
// The token is `base64url(wallet:exp).hmac` where hmac = HMAC-SHA256 over the
// base64url half with a server secret. Forgery needs the secret; tampering with
// wallet/exp breaks the MAC. Pure (secret + clock are injectable) so it's unit-
// testable; the env wrapper is the only impure part.

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2h

/** Server secret for the session HMAC. Dedicated var, else the agent-tick secret
 *  (already set in prod, server-only). Empty ⇒ admin sessions are disabled. */
function sessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.AGENT_TICK_SECRET || "";
}

export interface AdminToken {
  wallet: string;
  exp: number;
}

function mac(payloadB64: string, key: string): string {
  return createHmac("sha256", key).update(payloadB64).digest("base64url");
}

/** Mint a session token for `wallet`. null when no server secret is configured. */
export function issueAdminToken(
  wallet: string,
  opts: { now?: number; ttlMs?: number; key?: string } = {}
): string | null {
  const key = opts.key ?? sessionSecret();
  if (!key) return null;
  const exp = (opts.now ?? Date.now()) + (opts.ttlMs ?? DEFAULT_TTL_MS);
  const b64 = Buffer.from(`${wallet}:${exp}`).toString("base64url");
  return `${b64}.${mac(b64, key)}`;
}

/** Verify a session token → its claims, or null if invalid/expired/forged. */
export function verifyAdminToken(
  token: string | undefined | null,
  opts: { now?: number; key?: string } = {}
): AdminToken | null {
  const key = opts.key ?? sessionSecret();
  if (!key || !token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const got = token.slice(dot + 1);
  const want = mac(b64, key);
  const a = Buffer.from(got);
  const e = Buffer.from(want);
  if (a.length !== e.length || !timingSafeEqual(a, e)) return null;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString();
  } catch {
    return null;
  }
  const sep = payload.lastIndexOf(":");
  if (sep <= 0) return null;
  const wallet = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (!wallet || !Number.isFinite(exp) || (opts.now ?? Date.now()) > exp) return null;
  return { wallet, exp };
}

export const ADMIN_COOKIE = "loop_admin";
