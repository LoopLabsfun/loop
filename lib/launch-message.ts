// Canonical launch message, shared verbatim by the client (which signs it) and
// the server (which re-derives + verifies it). Kept dependency-free so the
// client bundle doesn't pull in tweetnacl.

const MAX_TICKER = 10;

export function normalizeTicker(ticker: string): string {
  return ticker
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, MAX_TICKER);
}

/**
 * Both client and server derive this the same way from the (normalized) ticker
 * + timestamp, so a signature can't be replayed for a different project.
 */
export function buildLaunchMessage(ticker: string, ts: number): string {
  return [
    "Loop — launch a project",
    `Ticker: $${normalizeTicker(ticker)}`,
    "Signing proves you control this wallet. No funds are moved.",
    `ts:${ts}`,
  ].join("\n");
}
