import { chainInfo } from "./chains/registry";
import type { Chain } from "./chains/types";

// Fallback SOL/USD snapshot. Live spot price comes from getSolUsd() in
// price.ts (server-only); this value is used when that call fails and inside
// the simulated trade feed (lib/api.ts), which is not yet wired to live data.
export const SOL_USD = 164;

export function usd(n: number): string {
  // Guard non-finite input (NaN/±Infinity) so a bad upstream number renders a
  // clean "0.00" instead of "NaN"/"∞" leaking into the UI — same posture as
  // fmtPrice/compactUsd below.
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function sol(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return (0).toFixed(digits);
  return n.toFixed(digits);
}

/** A token cashtag with EXACTLY one leading "$", regardless of how the ticker is
 *  stored — launched projects keep the "$" ("$FAME"), prelaunch drafts don't
 *  ("FAME"). Prepending "$" blindly double-stamps the launched ones ("$$FAME");
 *  this normalises both. Empty/blank → "". */
export function cashtag(ticker: string | null | undefined): string {
  const t = (ticker ?? "").replace(/^\$+/, "").trim();
  return t ? `$${t}` : "";
}

export function fmtPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "$0.0000";
  if (p >= 0.01) return "$" + p.toFixed(4);
  // Sub-cent: a fixed 6 decimals collapses a tiny price to a misleading value —
  // e.g. 0.0000062 → "$0.000006" (one significant figure, looks wrong next to the
  // live market cap). Scale the decimals to keep ~3 significant figures past the
  // leading zeros, so the price shown is the real one. Plain decimals (not
  // subscript notation) so it renders identically in the browser, the chart, and
  // the satori OG image. Capped so an absurdly small price can't run away.
  const leadingZeros = -Math.floor(Math.log10(p)) - 1;
  const decimals = Math.min(Math.max(6, leadingZeros + 3), 12);
  return "$" + p.toFixed(decimals);
}

const COMPACT_UNITS: [number, string][] = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/** Scale n to the appropriate compact unit, promoting to the next unit when
 *  rounding would produce a 4-digit prefix (e.g. 999_999 → "1.0M" not "1000K"). */
function scaleCompact(n: number, units: [number, string][]): [string, string] {
  for (let i = 0; i < units.length; i++) {
    const [v, suffix] = units[i];
    if (n >= v) {
      const scaled = n / v;
      const decimals = scaled >= 100 ? 0 : 1;
      if (parseFloat(scaled.toFixed(decimals)) >= 1000 && i > 0) {
        const [pv, ps] = units[i - 1];
        const promoted = n / pv;
        return [promoted.toFixed(promoted >= 100 ? 0 : 1), ps];
      }
      return [scaled.toFixed(decimals), suffix];
    }
  }
  return [n.toFixed(0), ""];
}

/** Compact USD, e.g. 1234 → "$1.2K", 6_900_000 → "$6.9M". "—" for 0/invalid. */
export function compactUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1000) return "$" + n.toFixed(0);
  const [val, suffix] = scaleCompact(n, COMPACT_UNITS);
  return "$" + val + suffix;
}

/** Compact integer count, e.g. 1234 → "1.2K", 1_000_000 → "1M". */
export function compactNum(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  const [val, suffix] = scaleCompact(n, COMPACT_UNITS);
  return val + suffix;
}

export function countdown(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return "00:00";
  const t = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(t / 60);
  const ss = String(t % 60).padStart(2, "0");
  return String(mm).padStart(2, "0") + ":" + ss;
}

export function nowStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}]`;
}

/** Short base58 address: 4 leading + 4 trailing chars. */
export function shortAddr(addr: string): string {
  return addr.length <= 9 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Explorer URL for an address. Solana Explorer, cluster-aware (mainnet omits
 *  ?cluster); pass chain "hood" for Robinhood Chain's Blockscout instead. */
export function explorerUrl(
  address: string,
  network: "mainnet" | "devnet" = "mainnet",
  chain: Chain = "solana"
): string {
  if (chain === "hood") return chainInfo("hood").explorerAddress(address);
  const base = `https://explorer.solana.com/address/${address}`;
  return network === "devnet" ? `${base}?cluster=devnet` : base;
}

/** Explorer URL for a transaction, cluster-aware; chain "hood" → Blockscout. */
export function explorerTx(
  signature: string,
  network: "mainnet" | "devnet" = "mainnet",
  chain: Chain = "solana"
): string {
  if (chain === "hood") return chainInfo("hood").explorerTx(signature);
  const base = `https://explorer.solana.com/tx/${signature}`;
  return network === "devnet" ? `${base}?cluster=devnet` : base;
}

/** Normalize a repo string ("github.com/owner/name", "https://github.com/owner/name(.git)",
 *  or "owner/name") to "owner/name", or null if it isn't a GitHub owner/name pair. */
export function repoSlug(repo: string): string | null {
  const cleaned = (repo || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const parts = cleaned.split("/");
  return parts.length === 2 && parts[0] && parts[1] ? `${parts[0]}/${parts[1]}` : null;
}

/** GitHub URL for the repo, or null if `repo` isn't a GitHub owner/name pair. */
export function repoUrl(repo: string): string | null {
  const slug = repoSlug(repo);
  return slug ? `https://github.com/${slug}` : null;
}

/** GitHub URL for a specific commit (verifiable build feed) — anyone can open the
 *  diff and confirm the agent really shipped it. Null if repo/hash don't resolve. */
export function commitUrl(repo: string, hash: string): string | null {
  const slug = repoSlug(repo);
  return slug && hash ? `https://github.com/${slug}/commit/${hash}` : null;
}

export function shortAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return `0s`;
  seconds = Math.floor(seconds);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
