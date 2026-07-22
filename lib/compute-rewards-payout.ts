import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: this treasury-PUSH path is the founder-run FALLBACK. The primary
// payout is claim-PULL (lib/compute-claim.ts + /api/compute/claim): the user
// signs the claim and pays their own ATA rent, so the treasury never spends
// rent per recipient. Founder decision 2026-07-21.
//
// COMPUTE REWARDS — PAYOUT (the real-money half). Sends actual $LOOP (an SPL
// token transfer, never native SOL) from the treasury's LOOP position to
// compute-pool contributors' linked payout addresses, bounded by what
// lib/compute-rewards-exec.ts's accrual actually credited them. $LOOP, not
// SOL/ETH, so a compute reward never competes with the agent's own
// Claude-spend treasury for the same native balance. Mirrors
// lib/fee-distribute-exec.ts's safety posture; the SPL instruction shape
// mirrors lib/prefunding-distribute.ts (this codebase's other SPL-transfer
// precedent — createAssociatedTokenAccountIdempotentInstruction +
// createTransferInstruction).
//
//   • DISARMED unless COMPUTE_REWARDS_PAY=1 (founder arms it explicitly).
//   • amounts come ONLY from the ledger's claimable (earned − claimed), which
//     itself only grows via accrual from VERIFIED (consensus_ok=true) work —
//     so it can never send more $LOOP than was genuinely earned, and a
//     confirmed send is recorded as "claimed" before the next transfer (no
//     double-send even if the process is interrupted mid-run).
//   • SAFETY BOLT: if COMPUTE_REWARDS_SOURCE_WALLET is set, the signer
//     (LAUNCH_SIGNER_SECRET) pubkey MUST equal it.
//   • Bounded by the treasury's ACTUAL $LOOP balance (partial payouts are
//     fine — the remainder stays claimable for next cycle) — and by a small
//     SOL reserve, since creating a first-time recipient ATA still costs a
//     little native SOL in rent even though the reward itself is $LOOP.
//   • mainnet + Helius required; dust-floored; fully failure-safe.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "./supabase";
import { parseSecretKeyJson } from "./vanity";
import { claimableLoopUnits } from "./compute-rewards";
import { TOKEN_DECIMALS } from "./chat";

export function computeRewardsPayArmed(env: Record<string, string | undefined> = process.env): boolean {
  return env.COMPUTE_REWARDS_PAY === "1";
}

export interface ComputePayoutOutcome {
  ok: boolean;
  sent: { deviceId: string; to: string; loop: number; sig: string }[];
  skipped: string[];
  note: string;
}

const LOOP_DECIMALS_FACTOR = 10 ** TOKEN_DECIMALS;

/**
 * Pay out every device's claimable $LOOP balance. `force` bypasses the env
 * arm gate for a founder-confirmed manual run only (mirrors
 * executeFeeDistribution's `force`) — the safety bolt and ledger-bounded
 * amounts apply either way.
 */
export async function executeComputeRewardsPayout(
  opts: { force?: boolean } = {}
): Promise<ComputePayoutOutcome> {
  if (!opts.force && !computeRewardsPayArmed()) {
    return { ok: false, sent: [], skipped: [], note: "disarmed (set COMPUTE_REWARDS_PAY=1)" };
  }
  if (!supabaseAdmin) return { ok: false, sent: [], skipped: [], note: "no service-role client" };
  const signerSecret = process.env.LAUNCH_SIGNER_SECRET;
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!signerSecret || !heliusKey) {
    return { ok: false, sent: [], skipped: [], note: "LAUNCH_SIGNER_SECRET / HELIUS_API_KEY missing" };
  }

  try {
    const { data: loopProject } = await supabaseAdmin
      .from("projects")
      .select("mint")
      .eq("key", "loop")
      .maybeSingle();
    const mint = (loopProject as { mint?: string } | null)?.mint;
    if (!mint) return { ok: false, sent: [], skipped: [], note: "$LOOP mint not set on the loop project row" };

    const { data: rows } = await supabaseAdmin
      .from("compute_rewards")
      .select("device_id, payout_address, earned_loop_units, claimed_loop_units, claim_pending_units");
    type Row = {
      device_id: string;
      payout_address: string | null;
      earned_loop_units: number;
      claimed_loop_units: number;
      claim_pending_units: number | null;
    };
    const candidates = ((rows ?? []) as Row[])
      .map((r) => ({
        deviceId: r.device_id,
        payoutAddress: r.payout_address,
        earnedLoopUnits: Number(r.earned_loop_units),
        claimedLoopUnits: Number(r.claimed_loop_units),
        // Units already signed over to the user in an in-flight claim — the
        // push path must not re-send them (double-payout otherwise).
        pendingLoopUnits: Number(r.claim_pending_units ?? 0),
      }))
      .filter((r) => r.payoutAddress && claimableLoopUnits(r) > 0);
    if (!candidates.length) return { ok: true, sent: [], skipped: [], note: "nothing claimable" };

    const secret = parseSecretKeyJson(signerSecret);
    if (!secret) {
      return { ok: false, sent: [], skipped: [], note: "LAUNCH_SIGNER_SECRET must be a 64-byte JSON array" };
    }
    const { Keypair, Connection, Transaction, PublicKey, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
    const {
      getAssociatedTokenAddress,
      getAccount,
      createAssociatedTokenAccountIdempotentInstruction,
      createTransferInstruction,
      TOKEN_PROGRAM_ID,
    } = await import("@solana/spl-token");
    const signer = Keypair.fromSecretKey(Uint8Array.from(secret));

    // SAFETY BOLT: when a source wallet is explicitly pinned, the signer must
    // be it — refuses to pay out from a wallet nobody configured on purpose.
    const sourceWallet = process.env.COMPUTE_REWARDS_SOURCE_WALLET?.trim() || undefined;
    if (sourceWallet && signer.publicKey.toBase58() !== sourceWallet) {
      return {
        ok: false,
        sent: [],
        skipped: [],
        note: `signer ${signer.publicKey.toBase58()} != COMPUTE_REWARDS_SOURCE_WALLET ${sourceWallet} — aborted`,
      };
    }

    const conn = new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, "confirmed");
    const mintPk = new PublicKey(mint);

    // SOL reserve: rewards are paid in $LOOP, but a first-time recipient's ATA
    // still costs a little native rent (~0.002 SOL) plus the tx fee — so the
    // treasury's OPERATING SOL (what funds the agent's own Claude spend) is
    // still guarded, just for a much smaller amount than a native-SOL payout
    // would need. Default 0.02 SOL headroom, configurable.
    const reserveSol = (() => {
      const n = Number(process.env.COMPUTE_REWARDS_RESERVE_SOL);
      return Number.isFinite(n) && n >= 0 ? n : 0.02;
    })();
    const balanceSol = (await conn.getBalance(signer.publicKey)) / LAMPORTS_PER_SOL;
    if (balanceSol - reserveSol <= 0) {
      return {
        ok: true,
        sent: [],
        skipped: [`source has ${balanceSol.toFixed(4)} SOL ≤ reserve ${reserveSol} — can't even afford ATA rent yet`],
        note: "below SOL reserve — held until the treasury can spare rent for new recipient accounts",
      };
    }

    // $LOOP headroom: bounded by what the treasury's own token account
    // actually holds — never sends more $LOOP than exists, partial is fine.
    const sourceAta = await getAssociatedTokenAddress(mintPk, signer.publicKey);
    let availableLoopUnits = 0;
    try {
      availableLoopUnits = Number((await getAccount(conn, sourceAta)).amount);
    } catch {
      return { ok: true, sent: [], skipped: [], note: "treasury has no $LOOP token account yet — nothing to pay out" };
    }
    if (availableLoopUnits <= 0) {
      return { ok: true, sent: [], skipped: [], note: "treasury holds 0 $LOOP — nothing to pay out" };
    }

    // Dust floor in $LOOP units (default 1 $LOOP — the token itself is cheap,
    // this just avoids a transfer too small to be worth the tx fee).
    const dustLoopUnits = (() => {
      const n = Number(process.env.COMPUTE_REWARDS_MIN_TRANSFER_LOOP);
      return Number.isFinite(n) && n > 0 ? Math.round(n * LOOP_DECIMALS_FACTOR) : LOOP_DECIMALS_FACTOR;
    })();

    const sent: ComputePayoutOutcome["sent"] = [];
    const skipped: string[] = [];

    for (const c of candidates) {
      const claimable = claimableLoopUnits(c);
      const sendUnits = Math.min(claimable, availableLoopUnits);
      if (sendUnits < dustLoopUnits) {
        skipped.push(`${c.deviceId}: ${(sendUnits / LOOP_DECIMALS_FACTOR).toFixed(2)} $LOOP (< dust floor or no headroom left)`);
        continue;
      }
      try {
        const toPk = new PublicKey(c.payoutAddress!);
        const destAta = await getAssociatedTokenAddress(mintPk, toPk);
        const bh = await conn.getLatestBlockhash("confirmed");
        const tx = new Transaction({
          feePayer: signer.publicKey,
          blockhash: bh.blockhash,
          lastValidBlockHeight: bh.lastValidBlockHeight,
        }).add(
          // Idempotent: a no-op if the recipient's $LOOP account already
          // exists, so this never fails on a repeat recipient.
          createAssociatedTokenAccountIdempotentInstruction(signer.publicKey, destAta, toPk, mintPk),
          createTransferInstruction(sourceAta, destAta, signer.publicKey, sendUnits, [], TOKEN_PROGRAM_ID)
        );
        const sig = await conn.sendTransaction(tx, [signer]);
        await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
        // Recorded as claimed IMMEDIATELY — before the next iteration — so an
        // interruption partway through this loop can never double-send.
        await supabaseAdmin
          .from("compute_rewards")
          .update({ claimed_loop_units: c.claimedLoopUnits + sendUnits, updated_at: new Date().toISOString() })
          .eq("device_id", c.deviceId);
        availableLoopUnits -= sendUnits;
        sent.push({ deviceId: c.deviceId, to: c.payoutAddress!, loop: sendUnits / LOOP_DECIMALS_FACTOR, sig });
      } catch (e) {
        skipped.push(`${c.deviceId}: send failed — ${e instanceof Error ? e.message : "error"}`);
      }
    }

    return {
      ok: true,
      sent,
      skipped,
      note: `paid ${sent.reduce((s, x) => s + x.loop, 0).toLocaleString()} $LOOP across ${sent.length} device(s)`,
    };
  } catch (e) {
    return { ok: false, sent: [], skipped: [], note: e instanceof Error ? e.message : "error" };
  }
}
