// Pure math for the compute-pool reward ledger — accrual planning + claimable
// balance. Mirrors lib/fee-ledger.ts's earned/claimed shape (accrual now,
// batch payout later) applied to a new source: verified device_assists /
// treasury_checks rows instead of swept creator fees. No I/O here; the
// database side is lib/compute-rewards-exec.ts (accrual) and
// lib/compute-rewards-payout.ts (the real $LOOP send).
//
// Paid in $LOOP (SPL token, 6 decimals — lib/chat.ts TOKEN_DECIMALS), never
// native SOL/ETH: a compute reward should never compete with the agent's own
// Claude-spend treasury for the same SOL.

export interface RewardLedgerRow {
  earnedLoopUnits: number;
  claimedLoopUnits: number;
}

/** earned − claimed, clamped ≥ 0 — never negative even if the ledger drifts. */
export function claimableLoopUnits(row: RewardLedgerRow): number {
  return Math.max(0, row.earnedLoopUnits - row.claimedLoopUnits);
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
  addLoopUnits: number;
}

/**
 * Group verified units by device and credit each one `ratePerUnitLoopUnits`
 * (in $LOOP base units, i.e. token amount × 10^6). Rate ≤ 0 means the reward
 * system is unconfigured (disarmed) — no accrual, matching this codebase's
 * "explicit env var arms real-money features" pattern (FEE_DISTRIBUTE,
 * PRELAUNCH_REFUNDS, COMPUTE_BUDGET_GATE, …). Later units for a device
 * override earlier ones' payout address (a device that re-links mid-batch
 * should credit its newest known address).
 */
export function planAccrual(units: VerifiedUnit[], ratePerUnitLoopUnits: number): AccrualPlanRow[] {
  if (ratePerUnitLoopUnits <= 0) return [];
  const byDevice = new Map<string, AccrualPlanRow>();
  for (const u of units) {
    const cur = byDevice.get(u.deviceId) ?? {
      deviceId: u.deviceId,
      payoutAddress: null,
      payoutAddressHood: null,
      addLoopUnits: 0,
    };
    cur.addLoopUnits += ratePerUnitLoopUnits;
    if (u.payoutAddress) cur.payoutAddress = u.payoutAddress;
    if (u.payoutAddressHood) cur.payoutAddressHood = u.payoutAddressHood;
    byDevice.set(u.deviceId, cur);
  }
  return Array.from(byDevice.values());
}
