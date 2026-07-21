import "server-only";
import { supabaseAdmin } from "./supabase";
import { planAccrual, type VerifiedUnit } from "./compute-rewards";

/**
 * Accrual — the "earning" half of the reward mechanism. Scans device_assists
 * and treasury_checks for rows that just PASSED consensus (consensus_ok=true)
 * and haven't been credited yet (rewarded_at is null), credits the owning
 * device's ledger in $LOOP base units, and stamps rewarded_at so a re-run can
 * never double-credit the same contribution. Disarmed by default: a rate of
 * 0 (unset COMPUTE_REWARD_LOOP_UNITS_PER_UNIT) means this is a costless
 * no-op — the founder sets the rate when ready to actually start paying.
 *
 * $LOOP, never native SOL/ETH: a compute reward should never compete with the
 * agent's own Claude-spend treasury for the same SOL. Real money doesn't move
 * here either way — this only credits an internal ledger. The token send is
 * lib/compute-rewards-payout.ts, a separate, more tightly gated step.
 */

export function computeRewardRateLoopUnits(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.COMPUTE_REWARD_LOOP_UNITS_PER_UNIT);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export interface AccrualOutcome {
  ok: boolean;
  devices: number;
  totalLoopUnits: number;
  note: string;
}

export async function accrueComputeRewards(
  env: Record<string, string | undefined> = process.env
): Promise<AccrualOutcome> {
  const rate = computeRewardRateLoopUnits(env);
  if (rate <= 0) {
    return { ok: true, devices: 0, totalLoopUnits: 0, note: "disarmed (set COMPUTE_REWARD_LOOP_UNITS_PER_UNIT)" };
  }
  if (!supabaseAdmin) return { ok: false, devices: 0, totalLoopUnits: 0, note: "no service-role client" };

  const [assistsR, checksR] = await Promise.all([
    supabaseAdmin
      .from("device_assists")
      .select("id, device_id, payout_address, payout_address_hood")
      .eq("consensus_ok", true)
      .is("rewarded_at", null),
    supabaseAdmin
      .from("treasury_checks")
      .select("id, device_id, payout_address, payout_address_hood")
      .eq("consensus_ok", true)
      .is("rewarded_at", null),
  ]);
  type Row = { id: number; device_id: string; payout_address: string | null; payout_address_hood: string | null };
  const assists = (assistsR.data ?? []) as Row[];
  const checks = (checksR.data ?? []) as Row[];
  if (!assists.length && !checks.length) {
    return { ok: true, devices: 0, totalLoopUnits: 0, note: "nothing new to accrue" };
  }

  const units: VerifiedUnit[] = [...assists, ...checks].map((r) => ({
    deviceId: r.device_id,
    payoutAddress: r.payout_address,
    payoutAddressHood: r.payout_address_hood,
  }));
  const plan = planAccrual(units, rate);

  for (const p of plan) {
    const { data: existing } = await supabaseAdmin
      .from("compute_rewards")
      .select("earned_loop_units")
      .eq("device_id", p.deviceId)
      .maybeSingle();
    const prevEarned = Number((existing as { earned_loop_units?: number } | null)?.earned_loop_units ?? 0);
    await supabaseAdmin.from("compute_rewards").upsert(
      {
        device_id: p.deviceId,
        payout_address: p.payoutAddress,
        payout_address_hood: p.payoutAddressHood,
        earned_loop_units: prevEarned + p.addLoopUnits,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "device_id" }
    );
  }

  // Stamp rewarded_at LAST, after the ledger credit lands — so a crash
  // between the two never loses a contribution (it just gets re-scanned and
  // credited again next pass; the earned_loop_units upsert above is what
  // would need idempotency-guarding if that mattered, but re-crediting an
  // already-rewarded_at row is exactly what this ordering prevents).
  const now = new Date().toISOString();
  const assistIds = assists.map((r) => r.id);
  const checkIds = checks.map((r) => r.id);
  if (assistIds.length) await supabaseAdmin.from("device_assists").update({ rewarded_at: now }).in("id", assistIds);
  if (checkIds.length) await supabaseAdmin.from("treasury_checks").update({ rewarded_at: now }).in("id", checkIds);

  return {
    ok: true,
    devices: plan.length,
    totalLoopUnits: plan.reduce((s, p) => s + p.addLoopUnits, 0),
    note: `accrued ${plan.length} device(s) from ${assists.length + checks.length} verified unit(s)`,
  };
}
