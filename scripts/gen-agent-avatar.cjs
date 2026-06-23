#!/usr/bin/env node
// Generates the Loop avatar PNG for the `looplabs-fun` GitHub account (the
// identity the agent commits under — lib/agent-git-identity.ts). GitHub has no
// API to set an account avatar, so this produces a square PNG to upload by hand
// at github.com/settings/profile → so the agent's commits + the verifiable build
// feed show the Loop mark instead of the default grey identicon.
//
// Pure Node (no deps): draws the brand mark — two overlapping white rings on the
// accent ground (#5b34d6, matching app/icon.tsx) — into an RGBA buffer and
// encodes a real PNG via zlib. Run: `node scripts/gen-agent-avatar.cjs`.
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const N = 512; // GitHub recommends a square ≥ 400px; 512 is crisp and < 1MB.
const BG = [0x5b, 0x34, 0xd6]; // brand accent
const FG = [0xff, 0xff, 0xff];

// Mark geometry (mirrors components/LoopMark.tsx: two rings, centers 28 apart,
// r13, stroke 9 — scaled to fill ~62% of the square and centered).
const s = (0.62 * N) / 54;
const R = 13 * s;
const halfStroke = (9 * s) / 2;
const cy = N / 2;
const cxL = N / 2 - 14 * s;
const cxR = N / 2 + 14 * s;

// Coverage of a stroked ring at distance d from its centre (1px feather AA).
function ringCov(d) {
  const inner = R - halfStroke;
  const outer = R + halfStroke;
  if (d < inner - 1 || d > outer + 1) return 0;
  const a = Math.min(1, Math.max(0, d - (inner - 1)));
  const b = Math.min(1, Math.max(0, outer + 1 - d));
  return Math.min(a, b, 1);
}

const buf = Buffer.alloc(N * (N * 4 + 1)); // +1 filter byte per row
let o = 0;
for (let y = 0; y < N; y++) {
  buf[o++] = 0; // filter: none
  for (let x = 0; x < N; x++) {
    const dL = Math.hypot(x + 0.5 - cxL, y + 0.5 - cy);
    const dR = Math.hypot(x + 0.5 - cxR, y + 0.5 - cy);
    const cov = Math.max(ringCov(dL), ringCov(dR));
    buf[o++] = Math.round(BG[0] + (FG[0] - BG[0]) * cov);
    buf[o++] = Math.round(BG[1] + (FG[1] - BG[1]) * cov);
    buf[o++] = Math.round(BG[2] + (FG[2] - BG[2]) * cov);
    buf[o++] = 255;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(buf, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, "..", "branding");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "looplabs-avatar.png");
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes, ${N}x${N})`);
console.log("Upload it at https://github.com/settings/profile (as looplabs-fun).");
