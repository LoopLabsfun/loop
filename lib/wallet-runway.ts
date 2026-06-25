// Pure, dependency-free helpers for estimating the agent wallet's build runway:
// how many days the current on-chain deploy rate can be sustained on the
// remaining balance. Used by <ProjectWallet>.

/**
 * Estimate days of runway remaining given the current wallet balance and the
 * SOL deployed on-chain in the last 24h.
 *
 * Returns null when the rate is zero or unknown (no recent deploys to
 * extrapolate from), when either input is non-finite, or when the balance is
 * zero or negative. A non-null result is always a positive finite number.
 */
export function walletRunway(
  balanceSol: number,
  solDeployed24h: number,
): number | null {
  if (
    !Number.isFinite(balanceSol) ||
    !Number.isFinite(solDeployed24h) ||
    balanceSol <= 0 ||
    solDeployed24h <= 0
  ) {
    return null;
  }
  return balanceSol / solDeployed24h;
}

/**
 * Format a runway estimate for display in a wallet footer.
 *
 * Examples: "< 1 day" · "~1 day" · "~7 days" · "~30 days"
 */
export function fmtRunwayDays(days: number): string {
  if (!Number.isFinite(days) || days < 1) return "< 1 day";
  const d = Math.round(days);
  return `~${d} day${d === 1 ? "" : "s"}`;
}
