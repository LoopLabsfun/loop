import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE REWARDS — PAYOUT (the real-money half). Sends actual SOL from a
// designated source wallet to compute-pool contributors' linked payout
// addresses, bounded by what lib/compute-rewards-exec.ts's accrual actually
// credited them. Mirrors lib/fee-distribute-exec.ts's safety posture exactly:
//
//   • DISARMED unless COMPUTE_REWARDS_PAY=1 (founder arms it explicitly).
//   • amounts come ONLY from the ledger's claimable (earned − claimed), which
//     itself only grows via accrual from VERIFIED (consensus_ok=true) work —
//     so it can never send more than was genuinely earned, and a confirmed
//     send is recorded as "claimed" before moving to the next transfer (no
//     double-send even if the process is interrupted mid-run).
//   • SAFETY BOLT: if COMPUTE_REWARDS_SOURCE_WALLET is set, the signer
//     (LAUNCH_SIGNER_SECRET) pubkey MUST equal it — refuses to send from an
//     unexpected wallet. Unset = no bolt (the signer wallet IS the source),
//     matching the pattern's LOOP-today default.
//   • mainnet + Helius required; dust-floored; reserve-guarded (never drains
//     the source below a safety margin); fully failure-safe (returns a note,
//     never throws).
//
// The Hood/ETH leg is accrual-only (lib/compute-rewards-exec.ts tracks
// earned_wei/claimed_wei) — payout execution for it is NOT built here; same
// documented gap as docs/compute-beta.md's "ETH payout leg pending $LOOP
// launch". Sending ETH needs its own signer path once a Hood treasury with
// spendable funds exists.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "./supabase";
import { parseSecretKeyJson } from "./vanity";
import { claimableLamports } from "./compute-rewards";

export function computeRewardsPayArmed(env: Record<string, string | undefined> = process.env): boolean {
  return env.COMPUTE_REWARDS_PAY === "1";
}

export interface ComputePayoutOutcome {
  ok: boolean;
  sent: { deviceId: string; to: string; sol: number; sig: string }[];
  skipped: string[];
  note: string;
}

/**
 * Pay out every device's claimable SOL balance. `force` bypasses the env arm
 * gate for a founder-confirmed manual run only (mirrors executeFeeDistribution's
 * `force`) — the safety bolt and ledger-bounded amounts apply either way.
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
    const { data: rows } = await supabaseAdmin
      .from("compute_rewards")
      .select("device_id, payout_address, earned_lamports, claimed_lamports");
    type Row = { device_id: string; payout_address: string | null; earned_lamports: number; claimed_lamports: number };
    const candidates = ((rows ?? []) as Row[])
      .map((r) => ({
        deviceId: r.device_id,
        payoutAddress: r.payout_address,
        earnedLamports: Number(r.earned_lamports),
        claimedLamports: Number(r.claimed_lamports),
      }))
      .filter((r) => r.payoutAddress && claimableLamports(r) > 0);
    if (!candidates.length) return { ok: true, sent: [], skipped: [], note: "nothing claimable" };

    const secret = parseSecretKeyJson(signerSecret);
    if (!secret) {
      return { ok: false, sent: [], skipped: [], note: "LAUNCH_SIGNER_SECRET must be a 64-byte JSON array" };
    }
    const { Keypair, Connection, SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } =
      await import("@solana/web3.js");
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

    // RESERVE GUARD: only the balance ABOVE the reserve is distributable, so a
    // payout run can never overdraw the source wallet or starve its own tx
    // fees. Configurable (COMPUTE_REWARDS_RESERVE_SOL), default 0.05 SOL —
    // same default as fee-distribute-exec.ts's FEE_DISTRIBUTE_RESERVE_SOL.
    const reserveSol = (() => {
      const n = Number(process.env.COMPUTE_REWARDS_RESERVE_SOL);
      return Number.isFinite(n) && n >= 0 ? n : 0.05;
    })();
    const balanceSol = (await conn.getBalance(signer.publicKey)) / LAMPORTS_PER_SOL;
    let availableSol = Math.max(0, balanceSol - reserveSol);
    if (availableSol <= 0) {
      return {
        ok: true,
        sent: [],
        skipped: [`source ${balanceSol.toFixed(4)} SOL ≤ reserve ${reserveSol} — nothing distributable yet`],
        note: "below reserve — held until the source wallet can spare it",
      };
    }

    // Dust floor: skip a transfer too small for the network fee to be worth it.
    const dust = (() => {
      const n = Number(process.env.COMPUTE_REWARDS_MIN_TRANSFER_SOL);
      return Number.isFinite(n) && n > 0 ? n : 0.001;
    })();
    const round9 = (n: number) => Math.round(n * 1e9) / 1e9;

    const sent: ComputePayoutOutcome["sent"] = [];
    const skipped: string[] = [];

    for (const c of candidates) {
      const claimableSol = claimableLamports(c) / LAMPORTS_PER_SOL;
      const sendSol = round9(Math.min(claimableSol, availableSol));
      if (sendSol < dust) {
        skipped.push(`${c.deviceId}: ${sendSol.toFixed(6)} SOL (< dust floor ${dust} or no headroom left)`);
        continue;
      }
      try {
        const lamports = Math.round(sendSol * LAMPORTS_PER_SOL);
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: signer.publicKey,
            toPubkey: new PublicKey(c.payoutAddress!),
            lamports,
          })
        );
        const sig = await conn.sendTransaction(tx, [signer]);
        const latest = await conn.getLatestBlockhash();
        await conn.confirmTransaction(
          { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
          "confirmed"
        );
        // Recorded as claimed IMMEDIATELY — before the next iteration — so an
        // interruption partway through this loop can never double-send.
        await supabaseAdmin
          .from("compute_rewards")
          .update({ claimed_lamports: c.claimedLamports + lamports, updated_at: new Date().toISOString() })
          .eq("device_id", c.deviceId);
        availableSol = round9(Math.max(0, availableSol - sendSol));
        sent.push({ deviceId: c.deviceId, to: c.payoutAddress!, sol: sendSol, sig });
      } catch (e) {
        skipped.push(`${c.deviceId}: send failed — ${e instanceof Error ? e.message : "error"}`);
      }
    }

    return {
      ok: true,
      sent,
      skipped,
      note: `paid ${sent.reduce((s, x) => s + x.sol, 0)} SOL across ${sent.length} device(s)`,
    };
  } catch (e) {
    return { ok: false, sent: [], skipped: [], note: e instanceof Error ? e.message : "error" };
  }
}
