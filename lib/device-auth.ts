import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Loop Compute device tokens — per-device credentials for the pool.
 *
 * Until now every node authenticated with the shared ingest secret
 * (COMPUTE_INGEST_SECRET / CRON_SECRET), which cannot be handed to devices we
 * don't own. A device token is stateless: `dt1.<deviceId>.<hmac>` signed with
 * DEVICE_TOKEN_SECRET (falls back to the ingest secret). Verifying recovers
 * the deviceId, so a device can only ever act as itself — revocation is
 * rotating the signing secret (v1; per-device revocation needs a table).
 *
 * Issue tokens with: npm run device:token -- <deviceId>
 */

const PREFIX = "dt1";
// v2 additionally embeds a linked Hood (EVM) payout address, verified once at
// link time (lib/signature.ts verifyHoodLinkProof + verifyEvmPersonalSign) —
// see docs on buildHoodLinkMessage. dt1 tokens keep working unchanged; a v1
// holder just has no Hood address until they link one and get reissued a v2.
const PREFIX_V2 = "dt2";

function signingSecret(): string {
  return (
    process.env.DEVICE_TOKEN_SECRET?.trim() ||
    process.env.COMPUTE_INGEST_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    ""
  );
}

function hmac(secret: string, deviceId: string): string {
  return createHmac("sha256", secret).update(`${PREFIX}:device:${deviceId}`).digest("hex");
}

function hmacV2(secret: string, deviceId: string, hoodAddress: string): string {
  return createHmac("sha256", secret)
    .update(`${PREFIX_V2}:device:${deviceId}:hood:${hoodAddress}`)
    .digest("hex");
}

/** Issue a token for a deviceId (server/CLI only). Null when unconfigured. */
export function issueDeviceToken(deviceId: string): string | null {
  const secret = signingSecret();
  const id = deviceId.trim();
  if (!secret || !id || id.length > 128 || id.includes(".")) return null;
  return `${PREFIX}.${id}.${hmac(secret, id)}`;
}

/** Issue a v2 token embedding a verified Hood payout address alongside the
 *  device's Solana identity. Null when unconfigured or inputs are malformed. */
export function issueDeviceTokenWithHood(deviceId: string, hoodAddress: string): string | null {
  const secret = signingSecret();
  const id = deviceId.trim();
  const addr = hoodAddress.trim().toLowerCase();
  if (!secret || !id || id.length > 128 || id.includes(".")) return null;
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return null;
  return `${PREFIX_V2}.${id}.${addr}.${hmacV2(secret, id, addr)}`;
}

/** Full verification: returns the embedded deviceId + linked hoodAddress (null
 *  for a v1 token or one with no link), or null if the token is invalid.
 *  Constant-time comparison; malformed input never throws. */
export function verifyDeviceTokenFull(
  token: string | null | undefined
): { deviceId: string; hoodAddress: string | null } | null {
  const secret = signingSecret();
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts[0] === PREFIX && parts.length === 3) {
    const [, deviceId, mac] = parts;
    if (!deviceId || deviceId.length > 128 || !/^[0-9a-f]{64}$/i.test(mac)) return null;
    const expected = Buffer.from(hmac(secret, deviceId), "hex");
    const got = Buffer.from(mac, "hex");
    if (expected.length !== got.length) return null;
    return timingSafeEqual(expected, got) ? { deviceId, hoodAddress: null } : null;
  }
  if (parts[0] === PREFIX_V2 && parts.length === 4) {
    const [, deviceId, hoodAddress, mac] = parts;
    if (
      !deviceId ||
      deviceId.length > 128 ||
      !/^0x[0-9a-f]{40}$/.test(hoodAddress) ||
      !/^[0-9a-f]{64}$/i.test(mac)
    )
      return null;
    const expected = Buffer.from(hmacV2(secret, deviceId, hoodAddress), "hex");
    const got = Buffer.from(mac, "hex");
    if (expected.length !== got.length) return null;
    return timingSafeEqual(expected, got) ? { deviceId, hoodAddress } : null;
  }
  return null;
}

/**
 * Verify a token; returns the embedded deviceId or null. Constant-time
 * comparison; malformed input never throws. Thin wrapper over
 * verifyDeviceTokenFull for callers that only need the deviceId.
 */
export function verifyDeviceToken(token: string | null | undefined): string | null {
  return verifyDeviceTokenFull(token)?.deviceId ?? null;
}

/** Constant-time string compare — a plain === leaks the match length/timing. */
function secretsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type ComputeAuth =
  | { ok: true; kind: "secret"; deviceId: null; hoodAddress: null }
  | { ok: true; kind: "device-token"; deviceId: string; hoodAddress: string | null }
  | { ok: false; kind: null; deviceId: null; hoodAddress: null };

/**
 * Authorize a Loop Compute request. Accepts either the shared ingest secret
 * (founder devices, cron) or a per-device token in `x-device-token`. Returns
 * the authenticated deviceId (+ linked Hood payout address, if any) when a
 * token was used, so callers can bind the write to that device and reject
 * spoofed `deviceId`/payout fields.
 */
export function authorizeCompute(req: Request): ComputeAuth {
  const secret =
    process.env.COMPUTE_INGEST_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
  const header =
    req.headers.get("x-compute-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (secret && header && secretsEqual(header, secret)) {
    return { ok: true, kind: "secret", deviceId: null, hoodAddress: null };
  }
  const verified = verifyDeviceTokenFull(req.headers.get("x-device-token"));
  if (verified) {
    return { ok: true, kind: "device-token", deviceId: verified.deviceId, hoodAddress: verified.hoodAddress };
  }
  return { ok: false, kind: null, deviceId: null, hoodAddress: null };
}
