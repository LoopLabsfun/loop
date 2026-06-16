import "server-only";

import type { LaunchCluster } from "./launchpad";
import { parseSecretKeyJson } from "./vanity";

// ─────────────────────────────────────────────────────────────────────────────
// CREATOR-FEE CLAIM — the agent claims its pump.fun creator fees autonomously.
//
// Flow (founder decision): the agent claims creator fees on pump.fun *by itself*
// → Loop custodies the funds → the founder later claims their dev-share from the
// Loop UI (an internal claim, not pump.fun). This module is the first half: the
// autonomous on-chain claim.
//
// Verified feasible: PumpPortal exposes the `collectCreatorFee` action on the
// non-custodial `/api/trade-local` endpoint — it returns an unsigned tx that the
// creator wallet signs and submits; ONE tx sweeps fees across all of that
// creator's tokens. No human/website step. Mirrors the create path in
// lib/pumpfun.ts and signs with the same creator wallet (LAUNCH_SIGNER_SECRET).
//
// Pump.fun is mainnet-only and this moves real SOL, so it's never exercised in
// CI; the pure payload + guardrail are unit-tested, the on-chain call is a thin
// wrapper. Server-only.
// ─────────────────────────────────────────────────────────────────────────────

const PUMPPORTAL_LOCAL = "https://pumpportal.fun/api/trade-local";

export interface CollectFeeResult {
  ok: boolean;
  /** Claim transaction signature on success. */
  txSig?: string;
  /** True when no creator wallet is configured — nothing was attempted. */
  skipped?: boolean;
  error?: string;
}

/** Pure: the PumpPortal `/trade-local` collectCreatorFee payload. */
export function buildCollectCreatorFeePayload(args: {
  publicKey: string;
  priorityFee?: number;
}) {
  return {
    publicKey: args.publicKey,
    action: "collectCreatorFee" as const,
    priorityFee: args.priorityFee ?? 0.000005,
  };
}

/**
 * Claim the creator's accrued pump.fun fees in one transaction. Builds the tx
 * via PumpPortal (non-custodial), signs with the creator wallet, and submits to
 * mainnet. Returns a result rather than throwing, so a failed claim never breaks
 * the agent cycle that triggered it. No-op (skipped) when LAUNCH_SIGNER_SECRET
 * is unset; mainnet-only.
 */
export async function collectCreatorFees(
  cluster: LaunchCluster = "mainnet"
): Promise<CollectFeeResult> {
  if (cluster !== "mainnet") {
    return { ok: false, error: "pump.fun creator fees are mainnet-only." };
  }
  const signerSecret = process.env.LAUNCH_SIGNER_SECRET;
  if (!signerSecret) return { ok: false, skipped: true };
  const signerBytes = parseSecretKeyJson(signerSecret);
  if (!signerBytes) {
    return { ok: false, error: "LAUNCH_SIGNER_SECRET must be a 64-byte JSON array." };
  }

  try {
    const { Keypair, Connection, VersionedTransaction } = await import(
      "@solana/web3.js"
    );
    const signer = Keypair.fromSecretKey(Uint8Array.from(signerBytes));
    const payload = buildCollectCreatorFeePayload({
      publicKey: signer.publicKey.toBase58(),
    });
    const res = await fetch(PUMPPORTAL_LOCAL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, error: `PumpPortal collectCreatorFee failed (${res.status}).` };
    }
    const txBytes = new Uint8Array(await res.arrayBuffer());
    const tx = VersionedTransaction.deserialize(txBytes);
    tx.sign([signer]);
    const endpoint = process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : "https://api.mainnet-beta.solana.com";
    const conn = new Connection(endpoint, "confirmed");
    const txSig = await conn.sendRawTransaction(tx.serialize());
    return { ok: true, txSig };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "claim failed" };
  }
}

// Manual guardrail: if the autonomous claim keeps failing (RPC down, pump.fun
// change, drained signer), stop retrying blind and escalate to a manual claim
// (a founder action) rather than spending on doomed attempts. Pure.
export const MAX_CLAIM_FAILURES = 3;

export function shouldEscalateClaim(consecutiveFailures: number): boolean {
  return consecutiveFailures >= MAX_CLAIM_FAILURES;
}
