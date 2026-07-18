// Issue a Loop Compute device token for a given deviceId.
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/device-token.ts <deviceId>
//
// Mirrors lib/device-auth.ts (kept in sync — same PREFIX + HMAC input).
// Hand the printed token to a device; it authenticates as exactly that id.
// Node ≥ 20.

import { createHmac } from "node:crypto";

const PREFIX = "dt1";

function signingSecret(): string {
  return (
    process.env.DEVICE_TOKEN_SECRET?.trim() ||
    process.env.COMPUTE_INGEST_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    ""
  );
}

const deviceId = (process.argv[2] || "").trim();
if (!deviceId) {
  console.error("usage: npx tsx scripts/device-token.ts <deviceId>");
  process.exit(1);
}
if (deviceId.length > 128 || deviceId.includes(".")) {
  console.error("deviceId must be ≤128 chars and contain no '.'");
  process.exit(1);
}
const secret = signingSecret();
if (!secret) {
  console.error("No signing secret — set DEVICE_TOKEN_SECRET (or COMPUTE_INGEST_SECRET / CRON_SECRET).");
  process.exit(1);
}

const mac = createHmac("sha256", secret).update(`${PREFIX}:device:${deviceId}`).digest("hex");
const token = `${PREFIX}.${deviceId}.${mac}`;

console.log(`\nDevice token for "${deviceId}":\n`);
console.log(`  ${token}\n`);
console.log("Give the device:");
console.log(`  LOOP_DEVICE_ID=${deviceId}`);
console.log(`  LOOP_DEVICE_TOKEN=${token}\n`);
console.log("It then authenticates without the shared ingest secret.\n");
