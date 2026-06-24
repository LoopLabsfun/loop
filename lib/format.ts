// Fallback SOL/USD snapshot. Live spot price comes from getSolUsd() in
// price.ts (server-only); this value is used when that call fails and inside
// the simulated trade feed (lib/api.ts), which is not yet wired to live data.
export const SOL_USD = 164;

export function usd(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function sol(n: number, digits = 2): string {
  return n.toFixed(digits);
}

export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return "$0.0000";
  return "$" + (p >= 0.01 ? p.toFixed(4) : p.toFixed(6));
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

/** Solana Explorer URL for an address, cluster-aware (mainnet omits ?cluster). */
export function explorerUrl(
  address: string,
  network: "mainnet" | "devnet" = "mainnet"
): string {
  const base = `https://explorer.solana.com/address/${address}`;
  return network === "devnet" ? `${base}?cluster=devnet` : base;
}

/** Solana Explorer URL for a transaction signature, cluster-aware. */
export function explorerTx(
  signature: string,
  network: "mainnet" | "devnet" = "mainnet"
): string {
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
  if (!isFinite(seconds) || seconds < 0) return `0s`;
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
