// Pure math for the compute-pool reward ledger — accrual planning + claimable
// balance. Mirrors lib/fee-ledger.ts's earned/claimed shape (accrual now,
// batch payout later) applied to a new source: verified device_assists /
// treasury_checks rows instead of swept creator fees. No I/O here; the
// database side is lib/compute-rewards-exec.ts (accrual) and
// lib/compute-rewards-payout.ts (the real SOL send).

export interface RewardLedgerRow {
  earnedLamports: number;
  claimedLamports: number;
}

/** earned − claimed, clamped ≥ 0 — never negative even if the ledger drifts. */
export function claimableLamports(row: RewardLedgerRow): number {
  return Math.max(0, row.earnedLamports - row.claimedLamports);
}

export interface VerifiedUnit {
  deviceId: string;
  payoutAddress: string | null;
  payoutAddressHood: string | null;
}

export interface AccrualPlanRow {
  deviceId: string;
  payoutAddress: string | null;
  payoutAddressHood: string | null;
  addLamports: number;
}

/**
 * Group verified units by device and credit each one `ratePerUnitLamports`.
 * Rate ≤ 0 means the reward system is unconfigured (disarmed) — no accrual,
 * matching this codebase's "explicit env var arms real-money features"
 * pattern (FEE_DISTRIBUTE, PRELAUNCH_REFUNDS, COMPUTE_BUDGET_GATE, …).
 * Later units for a device override earlier ones' payout address (a device
 * that re-links mid-batch should credit its newest known address).
 */
export function planAccrual(units: VerifiedUnit[], ratePerUnitLamports: number): AccrualPlanRow[] {
  if (ratePerUnitLamports <= 0) return [];
  const byDevice = new Map<string, AccrualPlanRow>();
  for (const u of units) {
    const cur = byDevice.get(u.deviceId) ?? {
      deviceId: u.deviceId,
      payoutAddress: null,
      payoutAddressHood: null,
      addLamports: 0,
    };
    cur.addLamports += ratePerUnitLamports;
    if (u.payoutAddress) cur.payoutAddress = u.payoutAddress;
    if (u.payoutAddressHood) cur.payoutAddressHood = u.payoutAddressHood;
    byDevice.set(u.deviceId, cur);
  }
  return Array.from(byDevice.values());
}
