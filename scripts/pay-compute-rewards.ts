// COMPUTE REWARDS PAYOUT — sends real $LOOP (SPL token, never native SOL/ETH)
// from the treasury's $LOOP position to every compute-pool device with a
// claimable balance (accrued by lib/compute-rewards-exec.ts from VERIFIED
// work only — see lib/compute-rewards-payout.ts for the full safety posture:
// disarmed by default, signer==source bolt, SOL reserve for ATA rent, $LOOP
// dust floor, claimed-before-next-send idempotency).
//
// Dry-run by default — shows what WOULD be sent without signing anything.
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/pay-compute-rewards.ts                # dry-run (default)
//   npx tsx scripts/pay-compute-rewards.ts --execute       # ALSO requires
//                                                           # COMPUTE_REWARDS_PAY=1
//                                                           # in the environment —
//                                                           # signs + broadcasts, moves real $LOOP.
import { createClient } from "@supabase/supabase-js";
import { claimableLoopUnits } from "../lib/compute-rewards";
import { executeComputeRewardsPayout, computeRewardsPayArmed } from "../lib/compute-rewards-payout";

const LOOP_DECIMALS_FACTOR = 1e6; // TOKEN_DECIMALS (lib/chat.ts)
const EXECUTE = process.argv.includes("--execute");

(async () => {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: rows, error } = await sb
    .from("compute_rewards")
    .select("device_id, payout_address, earned_loop_units, claimed_loop_units");
  if (error) throw new Error(error.message);

  type Row = { device_id: string; payout_address: string | null; earned_loop_units: number; claimed_loop_units: number };
  const candidates = ((rows ?? []) as Row[]).filter(
    (r) => r.payout_address && claimableLoopUnits({ earnedLoopUnits: r.earned_loop_units, claimedLoopUnits: r.claimed_loop_units }) > 0
  );

  console.log(`\n=== COMPUTE REWARDS PAYOUT ($LOOP, ${EXECUTE ? "EXECUTE" : "dry-run"}) ===`);
  if (!candidates.length) {
    console.log("nothing claimable — no devices have earned more than they've been paid.\n");
    return;
  }
  for (const c of candidates) {
    const loop = claimableLoopUnits({ earnedLoopUnits: c.earned_loop_units, claimedLoopUnits: c.claimed_loop_units }) / LOOP_DECIMALS_FACTOR;
    console.log(`  ${c.device_id}  →  ${c.payout_address}   ${loop.toLocaleString()} $LOOP claimable`);
  }

  if (!EXECUTE) {
    console.log("\n(dry-run) nothing signed. Re-run with --execute to broadcast.\n");
    return;
  }
  if (!computeRewardsPayArmed()) {
    console.log("\nABORTED: --execute was passed but COMPUTE_REWARDS_PAY=1 is not set in the environment.");
    console.log("Both are required to move real money — that's intentional, not a bug.\n");
    return;
  }

  const outcome = await executeComputeRewardsPayout();
  console.log(`\n${outcome.ok ? "✅" : "❌"} ${outcome.note}`);
  for (const s of outcome.sent) console.log(`  sent ${s.loop.toLocaleString()} $LOOP → ${s.to} (${s.deviceId})  sig=${s.sig}`);
  for (const s of outcome.skipped) console.log(`  skipped: ${s}`);
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
