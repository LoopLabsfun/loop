import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE REWARDS — CLAIM-PULL PAYOUT. The user claims their earned $LOOP and
// pays their own costs: the claim transaction's fee payer is the USER's wallet,
// which also funds its own $LOOP token-account rent (~0.002 SOL, once). The
// treasury never spends native SOL here — it only co-signs the SPL transfer.
// This replaces treasury-push (lib/compute-rewards-payout.ts, kept as a
// founder-run fallback) as the primary payout path.
//
// Flow (three server steps, one user signature):
//   build   → server builds a v0 tx {feePayer: user, ixs: createATA(payer=user)
//             + transfer(treasury→user, units) + memo nonce}, PARTIALLY signs
//             it with the treasury key, records the pending claim, returns the
//             tx base64. One in-flight claim per device (lock).
//   (user)  → wallet signs as fee payer and broadcasts (sendSwapTx).
//   confirm → server fetches the tx on-chain, checks the memo nonce + the
//             exact transfer, THEN credits claimed_loop_units and clears the
//             pending lock. Ledger only moves on on-chain proof.
//   expiry  → a pending tx whose blockhash expired can NEVER land; before
//             clearing the lock we scan the source token account's recent
//             signatures for the memo nonce (covers "landed but user never
//             confirmed"), finalizing if found.
//
// Safety mirrors the push path: COMPUTE_REWARDS_PAY=1 arm gate,
// COMPUTE_REWARDS_SOURCE_WALLET signer bolt, amounts bounded by the ledger
// (earned − claimed − pending) AND the treasury's actual $LOOP balance,
// dust floor, destination = the ENROLLED payout address only (never
// client-supplied).
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "./supabase";
import { parseSecretKeyJson } from "./vanity";
import { computeRewardsPayArmed } from "./compute-rewards-payout";
import { TOKEN_DECIMALS } from "./chat";

const LOOP_DECIMALS_FACTOR = 10 ** TOKEN_DECIMALS;
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/** Claim memos look like `loop-compute-claim:<deviceId>:<nonce>`. */
const memoText = (deviceId: string, nonce: string) => `loop-compute-claim:${deviceId}:${nonce}`;

interface LedgerRow {
  device_id: string;
  payout_address: string | null;
  earned_loop_units: number;
  claimed_loop_units: number;
  claim_pending_units: number;
  claim_nonce: string | null;
  claim_expires_block: number | null;
}

export interface ClaimQuote {
  ok: boolean;
  /** UI $LOOP available to claim right now (0 while a claim is in flight). */
  claimableLoop: number;
  /** UI $LOOP locked in an in-flight (unexpired) claim. */
  pendingLoop: number;
  note: string;
}

export interface ClaimBuildResult {
  ok: boolean;
  /** Base64 of the partially-signed v0 transaction (user signs + sends). */
  txBase64?: string;
  claimLoop?: number;
  note: string;
}

export interface ClaimConfirmResult {
  ok: boolean;
  claimedLoop?: number;
  note: string;
}

function dustUnits(): number {
  const n = Number(process.env.COMPUTE_REWARDS_MIN_TRANSFER_LOOP);
  return Number.isFinite(n) && n > 0 ? Math.round(n * LOOP_DECIMALS_FACTOR) : LOOP_DECIMALS_FACTOR;
}

async function getLedgerRow(deviceId: string): Promise<LedgerRow | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("compute_rewards")
    .select(
      "device_id, payout_address, earned_loop_units, claimed_loop_units, claim_pending_units, claim_nonce, claim_expires_block"
    )
    .eq("device_id", deviceId)
    .maybeSingle();
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    device_id: String(r.device_id),
    payout_address: (r.payout_address as string | null) ?? null,
    earned_loop_units: Number(r.earned_loop_units ?? 0),
    claimed_loop_units: Number(r.claimed_loop_units ?? 0),
    claim_pending_units: Number(r.claim_pending_units ?? 0),
    claim_nonce: (r.claim_nonce as string | null) ?? null,
    claim_expires_block: r.claim_expires_block == null ? null : Number(r.claim_expires_block),
  };
}

/** Signer + chain plumbing shared by build/confirm/reconcile. Throws with a
 *  human note when unconfigured. */
async function chainCtx() {
  const signerSecret = process.env.LAUNCH_SIGNER_SECRET;
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!signerSecret || !heliusKey) throw new Error("LAUNCH_SIGNER_SECRET / HELIUS_API_KEY missing");
  const secret = parseSecretKeyJson(signerSecret);
  if (!secret) throw new Error("LAUNCH_SIGNER_SECRET must be a 64-byte JSON array");
  const web3 = await import("@solana/web3.js");
  const spl = await import("@solana/spl-token");
  const signer = web3.Keypair.fromSecretKey(Uint8Array.from(secret));
  const bolt = process.env.COMPUTE_REWARDS_SOURCE_WALLET?.trim();
  if (bolt && signer.publicKey.toBase58() !== bolt) {
    throw new Error(`signer != COMPUTE_REWARDS_SOURCE_WALLET — aborted`);
  }
  const conn = new web3.Connection(
    `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`,
    "confirmed"
  );
  if (!supabaseAdmin) throw new Error("no service-role client");
  const { data: loopProject } = await supabaseAdmin
    .from("projects")
    .select("mint")
    .eq("key", "loop")
    .maybeSingle();
  const mint = (loopProject as { mint?: string } | null)?.mint;
  if (!mint) throw new Error("$LOOP mint not set on the loop project row");
  return { web3, spl, signer, conn, mint };
}

/**
 * Reconcile an expired pending claim before allowing a new one. An expired
 * blockhash means the old tx can never land NOW — but it may have landed
 * BEFORE expiring without the user confirming, so we scan the source token
 * account's recent history for the memo nonce and finalize if found.
 * Returns the row, refreshed if it changed.
 */
async function reconcileExpired(row: LedgerRow): Promise<LedgerRow> {
  if (!supabaseAdmin) return row;
  if (row.claim_pending_units <= 0 || !row.claim_nonce) return row;
  try {
    const { web3, spl, signer, conn, mint } = await chainCtx();
    const height = await conn.getBlockHeight("confirmed");
    // Still in flight (unexpired) — leave the lock alone.
    if (row.claim_expires_block != null && height <= row.claim_expires_block) return row;

    const sourceAta = await spl.getAssociatedTokenAddress(
      new web3.PublicKey(mint),
      signer.publicKey
    );
    const memo = memoText(row.device_id, row.claim_nonce);
    const sigs = await conn.getSignaturesForAddress(sourceAta, { limit: 25 }, "confirmed");
    // getSignaturesForAddress surfaces the memo field directly — no need to
    // fetch each transaction.
    const landed = sigs.some((s) => s.memo?.includes(memo) && s.err === null);
    if (landed) {
      await supabaseAdmin
        .from("compute_rewards")
        .update({
          claimed_loop_units: row.claimed_loop_units + row.claim_pending_units,
          claim_pending_units: 0,
          claim_nonce: null,
          claim_expires_block: null,
          updated_at: new Date().toISOString(),
        })
        .eq("device_id", row.device_id);
    } else {
      await supabaseAdmin
        .from("compute_rewards")
        .update({
          claim_pending_units: 0,
          claim_nonce: null,
          claim_expires_block: null,
          updated_at: new Date().toISOString(),
        })
        .eq("device_id", row.device_id);
    }
    return (await getLedgerRow(row.device_id)) ?? row;
  } catch {
    // Chain unreachable — keep the lock (safe side: no new claim issued).
    return row;
  }
}

/** What a device can claim right now (after reconciling any expired lock). */
export async function quoteClaim(deviceId: string): Promise<ClaimQuote> {
  if (!computeRewardsPayArmed()) {
    return { ok: false, claimableLoop: 0, pendingLoop: 0, note: "claims not open yet" };
  }
  let row = await getLedgerRow(deviceId);
  if (!row) return { ok: true, claimableLoop: 0, pendingLoop: 0, note: "nothing earned yet" };
  row = await reconcileExpired(row);
  const claimableUnits = Math.max(
    0,
    row.earned_loop_units - row.claimed_loop_units - row.claim_pending_units
  );
  return {
    ok: true,
    claimableLoop: claimableUnits / LOOP_DECIMALS_FACTOR,
    pendingLoop: row.claim_pending_units / LOOP_DECIMALS_FACTOR,
    note: row.claim_pending_units > 0 ? "a claim is in flight" : "ok",
  };
}

/**
 * Build the partially-signed claim transaction for a device. The user's wallet
 * is the fee payer (pays fee + own ATA rent); the treasury key has already
 * signed the token transfer. Ledger is NOT credited here — only `confirmClaim`
 * (on-chain proof) moves it.
 */
export async function buildClaimTx(deviceId: string): Promise<ClaimBuildResult> {
  if (!computeRewardsPayArmed()) return { ok: false, note: "claims not open yet (COMPUTE_REWARDS_PAY unset)" };
  if (!supabaseAdmin) return { ok: false, note: "no service-role client" };
  let row = await getLedgerRow(deviceId);
  if (!row) return { ok: false, note: "nothing earned yet" };
  row = await reconcileExpired(row);
  if (row.claim_pending_units > 0) {
    return { ok: false, note: "a claim is already in flight — send it or wait ~1 min for it to expire" };
  }
  if (!row.payout_address) return { ok: false, note: "no payout address on file" };
  const claimUnits = Math.max(0, row.earned_loop_units - row.claimed_loop_units);
  if (claimUnits < dustUnits()) {
    return { ok: false, note: `nothing claimable above the dust floor` };
  }

  try {
    const { web3, spl, signer, conn, mint } = await chainCtx();
    const mintPk = new web3.PublicKey(mint);
    const userPk = new web3.PublicKey(row.payout_address);
    const sourceAta = await spl.getAssociatedTokenAddress(mintPk, signer.publicKey);
    const destAta = await spl.getAssociatedTokenAddress(mintPk, userPk);

    // Bounded by what the treasury actually holds.
    let available = 0;
    try {
      available = Number((await spl.getAccount(conn, sourceAta)).amount);
    } catch {
      return { ok: false, note: "treasury has no $LOOP token account yet" };
    }
    const units = Math.min(claimUnits, available);
    if (units < dustUnits()) return { ok: false, note: "treasury $LOOP too low to cover a claim right now" };

    const nonce = crypto.randomUUID();
    const bh = await conn.getLatestBlockhash("confirmed");
    const ixs = [
      // The USER pays their own token-account rent — idempotent, so a repeat
      // claimer pays nothing here.
      spl.createAssociatedTokenAccountIdempotentInstruction(userPk, destAta, userPk, mintPk),
      spl.createTransferInstruction(sourceAta, destAta, signer.publicKey, units, [], spl.TOKEN_PROGRAM_ID),
      new web3.TransactionInstruction({
        programId: new web3.PublicKey(MEMO_PROGRAM_ID),
        keys: [],
        data: Buffer.from(memoText(deviceId, nonce), "utf8"),
      }),
    ];
    const msg = new web3.TransactionMessage({
      payerKey: userPk,
      recentBlockhash: bh.blockhash,
      instructions: ixs,
    }).compileToV0Message();
    const tx = new web3.VersionedTransaction(msg);
    tx.sign([signer]); // partial: the fee payer (user) signature is still missing

    await supabaseAdmin
      .from("compute_rewards")
      .update({
        claim_pending_units: units,
        claim_nonce: nonce,
        claim_expires_block: bh.lastValidBlockHeight,
        claim_requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("device_id", deviceId);

    return {
      ok: true,
      txBase64: Buffer.from(tx.serialize()).toString("base64"),
      claimLoop: units / LOOP_DECIMALS_FACTOR,
      note: "sign and send from your wallet — you pay the network fee and your own token-account rent",
    };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "build failed" };
  }
}

/**
 * Finalize a claim from its on-chain signature: the tx must be confirmed,
 * successful, and carry this device's pending memo nonce. Only then does the
 * ledger move.
 */
export async function confirmClaim(deviceId: string, signature: string): Promise<ClaimConfirmResult> {
  if (!supabaseAdmin) return { ok: false, note: "no service-role client" };
  const row = await getLedgerRow(deviceId);
  if (!row || row.claim_pending_units <= 0 || !row.claim_nonce) {
    return { ok: false, note: "no claim in flight for this device" };
  }
  try {
    const { conn } = await chainCtx();
    const tx = await conn.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) return { ok: false, note: "transaction not found yet — retry in a few seconds" };
    if (tx.meta?.err) return { ok: false, note: "transaction failed on-chain" };
    const memo = memoText(deviceId, row.claim_nonce);
    const logs = tx.meta?.logMessages ?? [];
    // The memo program logs its content — the nonce in the logs proves this is
    // OUR partially-signed tx (nothing else can carry it: the nonce never
    // leaves the server except inside the signed tx).
    if (!logs.some((l) => l.includes(memo))) {
      return { ok: false, note: "signature does not match the in-flight claim" };
    }
    await supabaseAdmin
      .from("compute_rewards")
      .update({
        claimed_loop_units: row.claimed_loop_units + row.claim_pending_units,
        claim_pending_units: 0,
        claim_nonce: null,
        claim_expires_block: null,
        updated_at: new Date().toISOString(),
      })
      .eq("device_id", deviceId);
    return {
      ok: true,
      claimedLoop: row.claim_pending_units / LOOP_DECIMALS_FACTOR,
      note: "claimed",
    };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "confirm failed" };
  }
}
