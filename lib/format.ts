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
  return "$" + (p >= 0.01 ? p.toFixed(4) : p.toFixed(6));
}

export function countdown(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60);
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return "0" + mm + ":" + ss;
}

export function nowStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}]`;
}

export function shortAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}
