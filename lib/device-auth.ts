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

/** Issue a token for a deviceId (server/CLI only). Null when unconfigured. */
export function issueDeviceToken(deviceId: string): string | null {
  const secret = signingSecret();
  const id = deviceId.trim();
  if (!secret || !id || id.length > 128 || id.includes(".")) return null;
  return `${PREFIX}.${id}.${hmac(secret, id)}`;
}

/**
 * Verify a token; returns the embedded deviceId or null. Constant-time
 * comparison; malformed input never throws.
 */
export function verifyDeviceToken(token: string | null | undefined): string | null {
  const secret = signingSecret();
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, deviceId, mac] = parts;
  if (!deviceId || deviceId.length > 128 || !/^[0-9a-f]{64}$/i.test(mac)) return null;
  const expected = Buffer.from(hmac(secret, deviceId), "hex");
  const got = Buffer.from(mac, "hex");
  if (expected.length !== got.length) return null;
  return timingSafeEqual(expected, got) ? deviceId : null;
}

export type ComputeAuth =
  | { ok: true; kind: "secret"; deviceId: null }
  | { ok: true; kind: "device-token"; deviceId: string }
  | { ok: false; kind: null; deviceId: null };

/**
 * Authorize a Loop Compute request. Accepts either the shared ingest secret
 * (founder devices, cron) or a per-device token in `x-device-token`. Returns
 * the authenticated deviceId when a token was used, so callers can bind the
 * write to that device and reject spoofed `deviceId` body fields.
 */
export function authorizeCompute(req: Request): ComputeAuth {
  const secret =
    process.env.COMPUTE_INGEST_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
  const header =
    req.headers.get("x-compute-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (secret && header && header === secret) {
    return { ok: true, kind: "secret", deviceId: null };
  }
  const deviceId = verifyDeviceToken(req.headers.get("x-device-token"));
  if (deviceId) return { ok: true, kind: "device-token", deviceId };
  return { ok: false, kind: null, deviceId: null };
}
