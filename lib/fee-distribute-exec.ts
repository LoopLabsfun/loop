import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// FEE DISTRIBUTION — EXECUTION (the autonomous, post-claim counterpart to the
// founder-run scripts/distribute-fees.ts). After the cron sweeps creator fees
// into the custodial creator==treasury wallet, this physically sends the AGENT
// (65%) and PLATFORM (5%) shares to their own wallets, so the 30/65/5 split is
// real money — closing the agent self-funding loop. The FOUNDER share stays in
// the treasury (already where it belongs for LOOP).
//
// REAL SOL MOVES HERE, so it is hard-gated and bounded:
//   • DISARMED unless FEE_DISTRIBUTE=1 (founder arms it explicitly).
//   • amounts come ONLY from the ledger's claimable (earned − claimed), which
//     itself only grows by amounts actually swept — so it can never send more
//     than was genuinely earned, and a confirmed send is recorded as "claimed"
//     before moving on (no double-send).
//   • SAFETY BOLT: the signer (LAUNCH_SIGNER_SECRET) pubkey MUST equal the
//     project's treasury/creator wallet — it never sends from any other wallet.
//   • mainnet + Helius required; dust-floored; fully failure-safe (returns a
//     note, never throws into the cron).
// The planning math is the pure, unit-tested planFeeDistribution (lib/fee-distribute).
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "./supabase";
import { planFeeDistribution, type FeeTransfer } from "./fee-distribute";
import { parseSecretKeyJson } from "./vanity";

export function feeDistributeArmed(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.FEE_DISTRIBUTE === "1";
}

export interface DistributeOutcome {
  ok: boolean;
  sent: { role: string; to: string; sol: number; sig: string }[];
  skipped: string[];
  note: string;
}

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/**
 * Distribute a project's accrued agent + platform fee shares on-chain. No-op
 * (note explains why) when disarmed, unconfigured, or nothing is claimable.
 * Never throws — the cron treats this as best-effort.
 */
export async function executeFeeDistribution(
  projectKey = "loop"
): Promise<DistributeOutcome> {
  if (!feeDistributeArmed()) {
    return { ok: false, sent: [], skipped: [], note: "disarmed (set FEE_DISTRIBUTE=1)" };
  }
  if (!supabaseAdmin) {
    return { ok: false, sent: [], skipped: [], note: "no service-role client" };
  }
  const signerSecret = process.env.LAUNCH_SIGNER_SECRET;
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!signerSecret || !heliusKey) {
    return { ok: false, sent: [], skipped: [], note: "LAUNCH_SIGNER_SECRET / HELIUS_API_KEY missing" };
  }

  try {
    const { data: proj } = await supabaseAdmin
      .from("projects")
      .select("treasury_wallet, creator_wallet, agent_wallet, fee_creator_wallet")
      .eq("key", projectKey)
      .maybeSingle();
    if (!proj) return { ok: false, sent: [], skipped: [], note: `project ${projectKey} not found` };
    const p = proj as {
      treasury_wallet?: string;
      creator_wallet?: string;
      agent_wallet?: string;
      fee_creator_wallet?: string;
    };
    // SOURCE = the wallet the creator fees were actually claimed into (the
    // on-chain pump.fun creator). Falls back to treasury/creator for legacy rows
    // where creator == treasury == founder (LOOP).
    const sourceWallet = p.fee_creator_wallet ?? p.treasury_wallet ?? p.creator_wallet;
    const founderWallet = p.creator_wallet; // founder share destination
    const agentWallet = p.agent_wallet;
    const platformWallet = process.env.PLATFORM_WALLET;

    const { data: ledger } = await supabaseAdmin
      .from("fee_ledger")
      .select("*")
      .eq("project_key", projectKey)
      .maybeSingle();
    const lrow = ledger as Record<string, unknown> | null;
    const claimableFounderSol = num(lrow?.earned_founder_sol) - num(lrow?.claimed_founder_sol);
    const claimableAgentSol = num(lrow?.earned_agent_sol) - num(lrow?.claimed_agent_sol);
    const claimablePlatformSol = num(lrow?.earned_platform_sol) - num(lrow?.claimed_platform_sol);

    const minTransferSol = (() => {
      const n = Number(process.env.FEE_MIN_TRANSFER_SOL);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    })();
    const plan = planFeeDistribution({
      claimableFounderSol,
      claimableAgentSol,
      claimablePlatformSol,
      founderWallet,
      agentWallet,
      platformWallet,
      // Any share whose destination IS the source wallet stays in place (e.g.
      // LOOP's founder share: creator == fee source). The agent/founder shares
      // for shared-signer projects DO move out, since their wallets differ.
      sourceWallet,
      minTransferSol,
    });
    if (!plan.transfers.length) {
      return { ok: true, sent: [], skipped: plan.skipped, note: "nothing claimable to distribute" };
    }

    const secret = parseSecretKeyJson(signerSecret);
    if (!secret) {
      return { ok: false, sent: [], skipped: plan.skipped, note: "LAUNCH_SIGNER_SECRET must be a 64-byte JSON array" };
    }
    const { Keypair, Connection, SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } =
      await import("@solana/web3.js");
    const signer = Keypair.fromSecretKey(Uint8Array.from(secret));

    // SAFETY BOLT: only ever send from the wallet the fees were claimed into (the
    // pump.fun creator / source). The signer MUST equal it — never disburse from
    // any other wallet.
    if (sourceWallet && signer.publicKey.toBase58() !== sourceWallet) {
      return {
        ok: false,
        sent: [],
        skipped: plan.skipped,
        note: `signer ${signer.publicKey.toBase58()} != fee source ${sourceWallet} — aborted`,
      };
    }

    const conn = new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, "confirmed");

    // RESERVE GUARD: never distribute SOL the treasury can't spare. Only the
    // balance ABOVE the reserve is distributable — so a payout can never overdraw
    // the wallet, drop it below the agent's wake threshold, or starve tx fees.
    // Reserve is configurable (FEE_DISTRIBUTE_RESERVE_SOL), default 0.05 SOL.
    const reserveSol = (() => {
      const n = Number(process.env.FEE_DISTRIBUTE_RESERVE_SOL);
      return Number.isFinite(n) && n >= 0 ? n : 0.05;
    })();
    const balanceSol = (await conn.getBalance(signer.publicKey)) / LAMPORTS_PER_SOL;
    let availableSol = Math.max(0, balanceSol - reserveSol);
    if (availableSol <= 0) {
      return {
        ok: true,
        sent: [],
        skipped: [
          ...plan.skipped,
          `treasury ${balanceSol.toFixed(4)} SOL ≤ reserve ${reserveSol} — nothing distributable yet`,
        ],
        note: "below reserve — held until the treasury can spare it",
      };
    }

    // Partial-send floor: don't bother with a transfer below this (gas would
    // dominate). Reuses the plan's dust floor.
    const dust = (() => {
      const n = Number(process.env.FEE_MIN_TRANSFER_SOL);
      return Number.isFinite(n) && n > 0 ? n : 0.001;
    })();
    const round9 = (n: number) => Math.round(n * 1e9) / 1e9;

    const sent: DistributeOutcome["sent"] = [];

    for (const t of plan.transfers as FeeTransfer[]) {
      // Send as much of this share as the spendable headroom allows (partial is
      // fine — the remainder stays claimable and flows next cycle), so a large
      // accrued share isn't stuck forever behind a small treasury. Never exceed
      // the headroom or the reserve.
      const sendSol = round9(Math.min(t.sol, availableSol));
      if (sendSol < dust) {
        plan.skipped.push(`${t.role}: only ${availableSol.toFixed(4)} SOL headroom (< ${dust}) — held for next cycle`);
        continue;
      }
      try {
        const lamports = Math.round(sendSol * LAMPORTS_PER_SOL);
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: signer.publicKey,
            toPubkey: new PublicKey(t.to),
            lamports,
          })
        );
        const sig = await conn.sendTransaction(tx, [signer]);
        const latest = await conn.getLatestBlockhash();
        await conn.confirmTransaction(
          { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
          "confirmed"
        );
        // Record as "claimed" so it's never sent twice, even if a later transfer
        // in this loop fails or the cron is interrupted.
        const col =
          t.role === "founder"
            ? "claimed_founder_sol"
            : t.role === "agent"
              ? "claimed_agent_sol"
              : "claimed_platform_sol";
        const prev = num(lrow?.[col]);
        await supabaseAdmin
          .from("fee_ledger")
          .update({ [col]: round9(prev + sendSol), updated_at: new Date().toISOString() })
          .eq("project_key", projectKey);
        if (lrow) lrow[col] = round9(prev + sendSol);
        availableSol = round9(Math.max(0, availableSol - sendSol));
        sent.push({ role: t.role, to: t.to, sol: sendSol, sig });
      } catch (e) {
        plan.skipped.push(`${t.role}: send failed — ${e instanceof Error ? e.message : "error"}`);
      }
    }

    return {
      ok: true,
      sent,
      skipped: plan.skipped,
      note: `distributed ${sent.reduce((s, x) => s + x.sol, 0)} SOL across ${sent.length} transfer(s)`,
    };
  } catch (e) {
    return { ok: false, sent: [], skipped: [], note: e instanceof Error ? e.message : "error" };
  }
}
