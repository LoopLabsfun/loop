import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Lightweight USER session, minted from one signed `looplabs.fun profile` proof
// (verifyProfileProof + pubkey===wallet) at /api/session. It lets the
// notification bell poll and follow/unfollow act without a wallet popup every
// time — the proof is checked ONCE, then this httpOnly-cookie HMAC token carries
// the wallet for ~7 days. Same stateless `base64url(wallet:exp).hmac` shape and
// secret-fallback as the founder admin session (lib/admin-session), just a longer
// TTL and a non-privileged scope (a user session grants only social actions on
// the signer's OWN wallet — never founder/admin powers).

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sessionSecret(): string {
  return process.env.USER_SESSION_SECRET || process.env.AGENT_TICK_SECRET || "";
}

export interface UserToken {
  wallet: string;
  exp: number;
}

function mac(payloadB64: string, key: string): string {
  return createHmac("sha256", key).update(payloadB64).digest("base64url");
}

/** Mint a user session token for `wallet`. null when no server secret is set. */
export function issueUserToken(wallet: string, opts: { now?: number; ttlMs?: number; key?: string } = {}): string | null {
  const key = opts.key ?? sessionSecret();
  if (!key) return null;
  const exp = (opts.now ?? Date.now()) + (opts.ttlMs ?? DEFAULT_TTL_MS);
  const b64 = Buffer.from(`${wallet}:${exp}`).toString("base64url");
  return `${b64}.${mac(b64, key)}`;
}

/** Verify a user session token → its claims, or null if invalid/expired/forged. */
export function verifyUserToken(token: string | undefined | null, opts: { now?: number; key?: string } = {}): UserToken | null {
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

export const USER_COOKIE = "loop_user";
