import "server-only";
import type { Project } from "./types";
import { getAgentWallet, privySignAndSendSolanaTx } from "./agent-wallet";
import { collectCreatorFees } from "./creator-fees";

// FOUNDER TREASURY ACTIONS — the money-moving half of the cockpit treasury panel.
// Two ops, each split into a PREVIEW (read-only, computes figures) and an EXEC
// (signs + sends). The route runs preview by default and only signs when the
// founder re-POSTs with confirm:true — so a click never moves funds without an
// explicit confirmation against shown numbers.
//
//   sweep — drain a project's agent (Privy) wallet → its treasury wallet, leaving
//           a rent+fee buffer. Per-project. Signed by Privy (server custody).
//   claim — collect pump.fun creator fees for the launch signer (lands on the
//           signer wallet). Signer-wide, mainnet-only. Signed by LAUNCH_SIGNER.

// Rent-exempt minimum + tx fee left behind so the source account stays valid.
export const SWEEP_BUFFER_LAMPORTS = 900_000;
const LAMPORTS_PER_SOL = 1_000_000_000;

export interface SweepPreview {
  op: "sweep";
  from: string | null;
  to: string | null;
  balanceSol: number | null;
  sweepableSol: number | null;
  bufferLamports: number;
  ready: boolean;
  reason?: string;
}

function rpcUrl(net: "mainnet" | "devnet"): string {
  const k = process.env.HELIUS_API_KEY;
  return k
    ? `https://${net}.helius-rpc.com/?api-key=${k}`
    : `https://api.${net === "mainnet" ? "mainnet-beta" : "devnet"}.solana.com`;
}

/** Read-only: what a sweep of this project's agent wallet → treasury would move. */
export async function previewSweep(p: Project): Promise<SweepPreview> {
  const net = p.network === "mainnet" ? "mainnet" : "devnet";
  const to = p.treasuryWallet ?? null;
  const base: SweepPreview = {
    op: "sweep",
    from: null,
    to,
    balanceSol: null,
    sweepableSol: null,
    bufferLamports: SWEEP_BUFFER_LAMPORTS,
    ready: false,
  };
  if (!to) return { ...base, reason: "project has no treasury wallet set." };
  const w = await getAgentWallet(p.key).catch(() => null);
  if (!w) return { ...base, reason: "agent wallet not provisioned." };

  try {
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const conn = new Connection(rpcUrl(net), "confirmed");
    const lamports = await conn.getBalance(new PublicKey(w.address));
    const sweepable = lamports - SWEEP_BUFFER_LAMPORTS;
    return {
      ...base,
      from: w.address,
      balanceSol: lamports / LAMPORTS_PER_SOL,
      sweepableSol: sweepable > 0 ? sweepable / LAMPORTS_PER_SOL : 0,
      ready: sweepable > 0,
      reason: sweepable > 0 ? undefined : "balance at or below the rent+fee buffer.",
    };
  } catch (e) {
    return { ...base, from: w.address, reason: e instanceof Error ? e.message : "read failed." };
  }
}

/** Execute the sweep computed by previewSweep (signs + sends via Privy). */
export async function execSweep(p: Project): Promise<{ ok: boolean; txSig?: string; error?: string }> {
  const pre = await previewSweep(p);
  if (!pre.ready || !pre.from || !pre.to) {
    return { ok: false, error: pre.reason ?? "nothing to sweep." };
  }
  const net = p.network === "mainnet" ? "mainnet" : "devnet";
  const w = await getAgentWallet(p.key).catch(() => null);
  if (!w) return { ok: false, error: "agent wallet not provisioned." };

  try {
    const { Connection, Transaction, SystemProgram, PublicKey } = await import("@solana/web3.js");
    const conn = new Connection(rpcUrl(net), "confirmed");
    const balance = await conn.getBalance(new PublicKey(w.address));
    const lamports = balance - SWEEP_BUFFER_LAMPORTS;
    if (lamports <= 0) return { ok: false, error: "nothing to sweep (balance below buffer)." };
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction();
    tx.feePayer = new PublicKey(w.address);
    tx.recentBlockhash = blockhash;
    tx.add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(w.address),
        toPubkey: new PublicKey(pre.to),
        lamports,
      })
    );
    const b64 = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");
    const sig = await privySignAndSendSolanaTx(w.id, b64, net);
    return { ok: true, txSig: sig };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "sweep failed." };
  }
}

export interface ClaimPreview {
  op: "claim";
  /** Whether a launch signer is configured (else nothing can be claimed). */
  armed: boolean;
  mainnetOnly: true;
  note: string;
}

/** Read-only: describe the signer-wide pump.fun creator-fee claim. There is no
 *  cheap dry-run of the accrued amount (PumpPortal builds the tx on demand), so
 *  this just reports whether the claim is armed and what it does. */
export function previewClaim(): ClaimPreview {
  const armed = Boolean(process.env.LAUNCH_SIGNER_SECRET);
  return {
    op: "claim",
    armed,
    mainnetOnly: true,
    note: armed
      ? "Claims all accrued pump.fun creator fees for the launch signer; the SOL lands on the signer wallet."
      : "LAUNCH_SIGNER_SECRET is not set — claiming is disabled.",
  };
}

/** Execute the signer-wide creator-fee claim (mainnet-only). */
export async function execClaim(): Promise<{ ok: boolean; txSig?: string; claimedSol?: number; error?: string }> {
  const r = await collectCreatorFees("mainnet");
  if (!r.ok) return { ok: false, error: r.skipped ? "claiming is disabled (no signer)." : r.error };
  return { ok: true, txSig: r.txSig, claimedSol: r.claimedSol };
}
