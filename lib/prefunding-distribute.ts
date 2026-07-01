import "server-only";
import { supabaseAdmin } from "./supabase";
import { privySignAndSendSolanaTx } from "./agent-wallet";
import type { LaunchCluster } from "./launchpad";
import { isMeaningfulContribution } from "./prefunding";

// ─────────────────────────────────────────────────────────────────────────────
// BACKER TOKEN DISTRIBUTION — the other half of "vote with SOL". Backers send
// SOL to a whitelisted project's Privy wallet BEFORE the mint; at launch that
// pooled SOL buys real tokens on the bonding curve. Those tokens must land with
// the BACKERS who funded the buy, proportional to their contribution — not sit
// in the project's own wallet as if the project itself had bought them.
//
// This runs as one extra step in approvePrelaunch, right after the mint (+ its
// own seed dev-buy, funded separately by the platform signer — never backer
// money) has landed: it buys ONE MORE time from the project's Privy wallet,
// spending whatever backer SOL is still sitting there, then splits the
// resulting tokens across backers by their share of the pool and sends each
// their cut. Reserve a small buffer for tx/rent fees; below-dust pools are
// left alone (refundable via the existing reject/refund path instead).
//
// Best-effort + never throws into the mint: a failure here leaves the SOL in
// the project wallet and the contributions "confirmed" (not yet distributed),
// so it can be retried rather than silently losing track of backers' money.
// ─────────────────────────────────────────────────────────────────────────────

const PUMPPORTAL_LOCAL = "https://pumpportal.fun/api/trade-local";
/** Kept in the project wallet after the buy — tx fees + a margin for the
 *  backer-transfer batch's own fees/rent that follow in the same flow. */
const RESERVE_SOL = 0.003;
/** Below this, the pooled backer SOL isn't worth a buy (gas would dominate). */
const MIN_POOL_SOL = 0.002;

function rpcEndpoint(cluster: LaunchCluster): string {
  const key = process.env.HELIUS_API_KEY;
  const host = cluster === "devnet" ? "devnet" : "mainnet";
  if (key) return `https://${host}.helius-rpc.com/?api-key=${key}`;
  return cluster === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com";
}

export interface BackerShare {
  wallet: string;
  sol: number;
  tokens: bigint;
}

/**
 * Pure: split `tokensBought` (raw base-unit integer) across backers
 * proportional to their (already wallet-grouped, summed) SOL contribution.
 * All-bigint/lamport-integer math — no floating point division of the token
 * amount, so there's no drift to accumulate across many backers. Any leftover
 * from integer division (at most `contributions.length - 1` base units) goes
 * to the largest contributor, mirroring the "remainder to the biggest share"
 * convention already used for SOL splits (lib/fee-attribution.ts,
 * lib/governance.ts) — never invented, never dropped.
 */
export function splitTokensByContribution(
  contributions: { wallet: string; sol: number }[],
  tokensBought: bigint,
): BackerShare[] {
  const ZERO = BigInt(0);
  const lamportsOf = (sol: number) => BigInt(Math.round(sol * 1e9));
  const totalLamports = contributions.reduce((s, c) => s + lamportsOf(c.sol), ZERO);
  if (totalLamports <= ZERO || tokensBought <= ZERO || contributions.length === 0) {
    return contributions.map((c) => ({ wallet: c.wallet, sol: c.sol, tokens: ZERO }));
  }
  const shares = contributions.map((c) => ({
    wallet: c.wallet,
    sol: c.sol,
    tokens: (tokensBought * lamportsOf(c.sol)) / totalLamports,
  }));
  const distributed = shares.reduce((s, x) => s + x.tokens, ZERO);
  const remainder = tokensBought - distributed;
  if (remainder > ZERO && shares.length > 0) {
    let biggest = shares[0];
    for (const s of shares) if (s.sol > biggest.sol) biggest = s;
    biggest.tokens += remainder;
  }
  return shares;
}

/** Pure: group raw contribution rows by contributor wallet (a backer can have
 *  several confirmed deposits), summing their SOL. Mirrors planRefunds'
 *  grouping so "how much does this backer get refunded" and "how many tokens
 *  does this backer get" always agree on the same total. */
export function groupContributionsByWallet(
  contributions: { contributorWallet: string; amountSol: number; status: string }[],
): { wallet: string; sol: number }[] {
  const byWallet = new Map<string, number>();
  for (const c of contributions) {
    if (c.status !== "confirmed" || !(c.amountSol > 0)) continue;
    byWallet.set(c.contributorWallet, (byWallet.get(c.contributorWallet) ?? 0) + c.amountSol);
  }
  return Array.from(byWallet.entries())
    .map(([wallet, sol]) => ({ wallet, sol: Math.round(sol * 1e9) / 1e9 }))
    .filter((c) => isMeaningfulContribution(c.sol));
}

export interface DistributeBackersOutcome {
  ok: boolean;
  note: string;
  paid: { wallet: string; sol: number; tokens: string; sig: string }[];
  skipped: string[];
}

async function pumpPortalBuy(
  buyer: string,
  mint: string,
  amountSol: number,
): Promise<Uint8Array> {
  const r = await fetch(PUMPPORTAL_LOCAL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: buyer,
      action: "buy",
      mint,
      denominatedInSol: "true",
      amount: amountSol,
      slippage: 15,
      priorityFee: 0.0005,
      pool: "pump",
    }),
  });
  if (!r.ok) throw new Error(`PumpPortal buy failed (${r.status}): ${await r.text()}`);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * Buy in with whatever backer SOL is pooled in the project's Privy wallet, then
 * pay each backer their proportional cut of the tokens that buy produced.
 * Idempotent per backer row: a row is only ever flipped to "distributed" AFTER
 * its transfer confirms, so a retry after a partial failure only re-processes
 * what didn't go out — but the BUY itself is not idempotent (it's one buy for
 * the whole remaining pool), so this must only be called once per launch; the
 * caller (approvePrelaunch) enforces that by construction (one mint, one call).
 */
export async function distributeBackerTokens(args: {
  draftWallet: string;
  projectWallet: string;
  projectWalletId: string;
  mint: string;
  cluster: LaunchCluster;
}): Promise<DistributeBackersOutcome> {
  const sb = supabaseAdmin;
  const empty = (note: string): DistributeBackersOutcome => ({ ok: false, note, paid: [], skipped: [] });
  if (!sb) return empty("no service-role client");
  if (args.cluster !== "mainnet") return empty("pump.fun is mainnet-only");

  try {
    const { data } = await sb
      .from("prelaunch_contributions")
      .select("contributor_wallet, amount_sol, status")
      .eq("draft_wallet", args.draftWallet)
      .eq("status", "confirmed");
    const rows = ((data ?? []) as { contributor_wallet: string; amount_sol: number; status: string }[]).map((r) => ({
      contributorWallet: r.contributor_wallet,
      amountSol: Number(r.amount_sol),
      status: r.status,
    }));
    const grouped = groupContributionsByWallet(rows);
    if (!grouped.length) return { ok: true, note: "no backers to distribute to", paid: [], skipped: [] };

    const { Connection, PublicKey, Transaction } = await import("@solana/web3.js");
    const { getMint, getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, TOKEN_PROGRAM_ID } =
      await import("@solana/spl-token");
    const conn = new Connection(rpcEndpoint(args.cluster), "confirmed");
    const mintPk = new PublicKey(args.mint);
    const projectWalletPk = new PublicKey(args.projectWallet);

    const balLamports = await conn.getBalance(projectWalletPk);
    const poolSol = Math.max(0, balLamports / 1e9 - RESERVE_SOL);
    if (poolSol < MIN_POOL_SOL) {
      return { ok: true, note: `${poolSol.toFixed(5)} SOL left in the project wallet — below the ${MIN_POOL_SOL} SOL buy-in floor`, paid: [], skipped: [] };
    }

    const projectAta = await getAssociatedTokenAddress(mintPk, projectWalletPk);
    const beforeBal = await getAccount(conn, projectAta).then((a) => a.amount).catch(() => BigInt(0));

    // The buy-in: spend the pooled backer SOL from the project's own wallet.
    // PumpPortal returns an UNSIGNED tx; hand its raw bytes straight to Privy
    // (which fills the payer's signature slot and broadcasts) — same pattern as
    // the existing dev-buy in lib/pumpfun.ts's createOnPumpPortalWithPrivy.
    // Round-tripping it through VersionedTransaction.deserialize/.serialize
    // first is unnecessary and risks a malformed re-encode of a tx that isn't
    // fully signed yet.
    const latestBeforeBuy = await conn.getLatestBlockhash("confirmed");
    const unsignedBuy = await pumpPortalBuy(args.projectWallet, args.mint, poolSol);
    const buySig = await privySignAndSendSolanaTx(args.projectWalletId, Buffer.from(unsignedBuy).toString("base64"), args.cluster);
    await conn.confirmTransaction({ signature: buySig, ...latestBeforeBuy }, "confirmed");

    const afterBal = await getAccount(conn, projectAta).then((a) => a.amount);
    const tokensBought = afterBal - beforeBal;
    if (tokensBought <= BigInt(0)) {
      return { ok: false, note: `buy-in landed (${buySig}) but yielded no measurable tokens — left for manual review`, paid: [], skipped: [] };
    }

    const shares = splitTokensByContribution(grouped, tokensBought);
    const mintInfo = await getMint(conn, mintPk);
    const paid: DistributeBackersOutcome["paid"] = [];
    const skipped: string[] = [];

    // Batch a few transfers per tx (ATA-create + transfer per backer) to stay
    // well under the transaction size limit.
    const BATCH_SIZE = 6;
    for (let i = 0; i < shares.length; i += BATCH_SIZE) {
      const batch = shares.slice(i, i + BATCH_SIZE).filter((s) => s.tokens > BigInt(0));
      if (!batch.length) continue;
      const ixs = [];
      for (const s of batch) {
        try {
          const backerPk = new PublicKey(s.wallet);
          const backerAta = await getAssociatedTokenAddress(mintPk, backerPk);
          ixs.push(createAssociatedTokenAccountIdempotentInstruction(projectWalletPk, backerAta, backerPk, mintPk));
          ixs.push(createTransferInstruction(projectAta, backerAta, projectWalletPk, s.tokens, [], TOKEN_PROGRAM_ID));
        } catch (e) {
          skipped.push(`${s.wallet.slice(0, 4)}…: ${e instanceof Error ? e.message : "bad wallet"}`);
        }
      }
      if (!ixs.length) continue;
      const bh = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: projectWalletPk, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }).add(...ixs);
      try {
        const b64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
        const sig = await privySignAndSendSolanaTx(args.projectWalletId, b64, args.cluster);
        await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
        for (const s of batch) {
          paid.push({ wallet: s.wallet, sol: s.sol, tokens: (Number(s.tokens) / 10 ** mintInfo.decimals).toString(), sig });
        }
        // Mark this batch's rows distributed BEFORE moving to the next batch, so
        // a failure partway through never re-sends what already landed.
        await sb
          .from("prelaunch_contributions")
          .update({ status: "distributed" })
          .eq("draft_wallet", args.draftWallet)
          .eq("status", "confirmed")
          .in("contributor_wallet", batch.map((s) => s.wallet));
      } catch (e) {
        skipped.push(`batch ${i / BATCH_SIZE + 1}: ${e instanceof Error ? e.message : "transfer failed"}`);
      }
    }

    return {
      ok: true,
      note: `bought in for ${poolSol.toFixed(4)} SOL (tx ${buySig}) → distributed to ${paid.length}/${grouped.length} backer(s)`,
      paid,
      skipped,
    };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "backer distribution error", paid: [], skipped: [] };
  }
}
