import "server-only";
import { isSolanaAddress } from "./api-guards";
import { makeSplit, type FeeSplit } from "./fees";
import { parseSecretKeyJson } from "./vanity";
import { privySignAndSendSolanaTx } from "./agent-wallet";
import type { LaunchCluster } from "./launchpad";

// ─────────────────────────────────────────────────────────────────────────────
// NATIVE FEE SHARING — pump.fun's own on-chain multi-recipient creator-fee split
// (launched Jan 2026), used INSTEAD of Loop's off-chain "claim the shared
// creator wallet, attribute by volume, manually wire transfer" pipeline
// (lib/fee-attribution.ts + lib/fee-distribute-exec.ts).
//
// Why: that pipeline only works because every project shares ONE on-chain
// creator wallet (the LAUNCH_SIGNER), so a claim sweeps everyone's fees into one
// lump that then has to be GUESSED apart by trading volume. pump.fun's fee-
// sharing program splits PER MINT, exactly, on-chain — no commingling, no
// estimation, no manual transfer.
//
// Lifecycle (per pump-fun/pump-public-docs, instructions/CREATOR_FEE_SHARING.md):
//   1. create_fee_sharing_config — opt the mint into shared distribution.
//   2. update_fee_shares_v2 — set the FINAL shareholder list. ONE-TIME: the doc
//      is explicit that this "can only effectively be used once per
//      sharing_config" (admin_revoked = true afterward). So the 30/65/5 split
//      decided at launch is irrevocable — nobody, including Loop, can change it
//      later. That's the trade-off for "set once, trustlessly enforced forever."
//   3. distribute_creator_fees_v2 — PERMISSIONLESS payout of the accrued
//      bonding-curve creator vault to each shareholder, proportional to their
//      bps. Anyone can call this (we use it from the cron); the split itself
//      can't be redirected by whoever happens to call it.
//
// Uses pump.fun's own official SDK (@pump-fun/pump-sdk, npm, org `pump-fun`,
// the same SDK their public docs reference for this exact feature).
//
// Env-gated (PUMP_FEE_SHARING=1) + best-effort: every export here returns a
// result object and never throws into its caller, mirroring the rest of the
// provisioning/launch seam (lib/provisioning-exec.ts, lib/prelaunch.ts).
// ─────────────────────────────────────────────────────────────────────────────

export function pumpFeeSharingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PUMP_FEE_SHARING === "1";
}

export interface FeeShareWallets {
  founderWallet: string | null | undefined;
  agentWallet: string | null | undefined;
  platformWallet: string | null | undefined;
}

export interface ShareEntry {
  address: string;
  shareBps: number;
}

/**
 * Pure: build the on-chain shareholder list from the platform's standard
 * founder/agent/platform split. Wallets that coincide (e.g. a project where the
 * founder wallet is also the agent wallet) are merged into one entry — the
 * on-chain instruction rejects duplicate addresses outright. Returns an error
 * string instead of a list when a required wallet is missing/invalid or the
 * total wouldn't reach 10,000 bps, so the caller can surface a clear reason
 * rather than letting the chain reject an opaque transaction.
 */
export function buildShareholders(
  wallets: FeeShareWallets,
  founderPct: number | null | undefined,
): { ok: true; shareholders: ShareEntry[] } | { ok: false; error: string } {
  const split: FeeSplit = makeSplit(founderPct ?? 30);
  const parts: { role: string; wallet: string | null | undefined; bps: number }[] = [
    { role: "founder", wallet: wallets.founderWallet, bps: split.founderPct * 100 },
    { role: "agent", wallet: wallets.agentWallet, bps: split.agentPct * 100 },
    { role: "platform", wallet: wallets.platformWallet, bps: split.platformPct * 100 },
  ];
  for (const p of parts) {
    if (p.bps > 0 && !isSolanaAddress(p.wallet)) {
      return { ok: false, error: `${p.role} wallet missing/invalid (needs ${p.bps} bps)` };
    }
  }
  const merged = new Map<string, number>();
  for (const p of parts) {
    if (p.bps <= 0 || !p.wallet) continue;
    merged.set(p.wallet, (merged.get(p.wallet) ?? 0) + p.bps);
  }
  const shareholders = Array.from(merged.entries()).map(([address, shareBps]) => ({ address, shareBps }));
  const total = shareholders.reduce((s, x) => s + x.shareBps, 0);
  if (shareholders.length === 0 || total !== 10_000) {
    return { ok: false, error: `shares must sum to 10,000 bps (got ${total})` };
  }
  return { ok: true, shareholders };
}

function rpcEndpoint(cluster: LaunchCluster): string {
  const key = process.env.HELIUS_API_KEY;
  const host = cluster === "devnet" ? "devnet" : "mainnet";
  if (key) return `https://${host}.helius-rpc.com/?api-key=${key}`;
  return cluster === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com";
}

export interface SetupOutcome {
  ok: boolean;
  note: string;
  txSig?: string;
}

/**
 * One-time setup, right after a fresh mint: opt the coin into fee-sharing and
 * permanently fix the founder/agent/platform split. Both instructions go in a
 * SINGLE transaction (create-then-use-in-same-tx is standard Solana practice),
 * so it's atomic — either the coin ends up fully configured, or nothing
 * happens (no half-opted-in state to clean up on retry).
 *
 * `creator` must be the coin's CURRENT on-chain creator (the only signer
 * `create_fee_sharing_config` accepts besides pump.fun's own global authority).
 * Pass a raw Keypair for the shared-signer launch path, or `{ privyWalletId,
 * address }` for privy-creator mode.
 */
export async function setupFeeSharing(args: {
  mint: string;
  creator: { secretKey: Uint8Array } | { privyWalletId: string; address: string };
  shareholders: ShareEntry[];
  cluster: LaunchCluster;
}): Promise<SetupOutcome> {
  if (!pumpFeeSharingEnabled()) return { ok: false, note: "disarmed (set PUMP_FEE_SHARING=1)" };
  if (args.cluster !== "mainnet") return { ok: false, note: "pump.fun fee-sharing is mainnet-only" };
  try {
    const { PUMP_SDK } = await import("@pump-fun/pump-sdk");
    const { NATIVE_MINT, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
    const { Connection, PublicKey, Keypair, Transaction } = await import("@solana/web3.js");

    const mint = new PublicKey(args.mint);
    const creatorAddress = new PublicKey("secretKey" in args.creator ? Keypair.fromSecretKey(args.creator.secretKey).publicKey : args.creator.address);

    const createIx = await PUMP_SDK.createFeeSharingConfig({ creator: creatorAddress, mint, pool: null });
    const updateIx = await PUMP_SDK.updateFeeSharesV2({
      authority: creatorAddress,
      mint,
      currentShareholders: [creatorAddress],
      newShareholders: args.shareholders.map((s) => ({ address: new PublicKey(s.address), shareBps: s.shareBps })),
      quoteMint: NATIVE_MINT,
      quoteTokenProgram: TOKEN_PROGRAM_ID,
    });

    const conn = new Connection(rpcEndpoint(args.cluster), "confirmed");
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: creatorAddress, blockhash, lastValidBlockHeight }).add(createIx, updateIx);

    let sig: string;
    if ("secretKey" in args.creator) {
      const signer = Keypair.fromSecretKey(args.creator.secretKey);
      sig = await conn.sendTransaction(tx, [signer]);
    } else {
      const b64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
      sig = await privySignAndSendSolanaTx(args.creator.privyWalletId, b64, args.cluster);
    }
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return { ok: true, note: "fee-sharing configured (irrevocable)", txSig: sig };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "fee-sharing setup error" };
  }
}

export interface DistributeOutcome {
  ok: boolean;
  note: string;
  txSig?: string;
}

/** Minimum vault balance worth spending a transaction on (gas would otherwise
 *  dominate a dust payout). */
const MIN_DISTRIBUTE_SOL = 0.002;

/**
 * Periodic, permissionless payout: sweep any AMM-side fees back into the
 * bonding curve (harmless no-op pre-graduation) then pay the bonding-curve
 * creator vault out to every configured shareholder, proportional to their
 * bps. Anyone can call this — the split itself is fixed on-chain, so calling
 * it changes nothing about WHERE the money goes, only WHEN it's flushed.
 * Best-effort + dust-floored; never throws.
 */
export async function distributeFeeSharing(args: {
  mint: string;
  payerSecretKey: Uint8Array;
  cluster: LaunchCluster;
}): Promise<DistributeOutcome> {
  if (!pumpFeeSharingEnabled()) return { ok: false, note: "disarmed (set PUMP_FEE_SHARING=1)" };
  if (args.cluster !== "mainnet") return { ok: false, note: "pump.fun fee-sharing is mainnet-only" };
  try {
    const { PUMP_SDK, OnlinePumpSdk, feeSharingConfigPda } = await import("@pump-fun/pump-sdk");
    const { NATIVE_MINT, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
    const { Connection, PublicKey, Keypair, Transaction } = await import("@solana/web3.js");

    const mint = new PublicKey(args.mint);
    const payer = Keypair.fromSecretKey(args.payerSecretKey);
    const conn = new Connection(rpcEndpoint(args.cluster), "confirmed");
    const online = new OnlinePumpSdk(conn);

    const sharingConfigAddress = feeSharingConfigPda(mint);
    const sharingConfigInfo = await conn.getAccountInfo(sharingConfigAddress);
    if (!sharingConfigInfo) return { ok: false, note: "no sharing_config for this mint yet" };
    const sharingConfig = PUMP_SDK.decodeSharingConfig(sharingConfigInfo);

    const vaultLamports = await online.getCreatorVaultBalanceBothPrograms(sharingConfigAddress);
    const vaultSol = vaultLamports.toNumber() / 1e9;
    if (vaultSol < MIN_DISTRIBUTE_SOL) {
      return { ok: true, note: `${vaultSol.toFixed(5)} SOL accrued — below the ${MIN_DISTRIBUTE_SOL} SOL dust floor` };
    }

    const ixs = [];
    // AMM-side sweep only applies once the coin has graduated; best-effort —
    // a pre-graduation coin has no AMM vault, so this naturally has nothing to
    // sweep (errors here are swallowed, never blocking the bonding-curve payout).
    try {
      ixs.push(
        await PUMP_SDK.transferCreatorFeesToPumpV2({
          payer: payer.publicKey,
          mint,
          quoteMint: NATIVE_MINT,
          quoteTokenProgram: TOKEN_PROGRAM_ID,
        }),
      );
    } catch {
      /* not graduated yet (or nothing to sweep) — fine, proceed to distribute */
    }
    ixs.push(
      await PUMP_SDK.distributeCreatorFeesV2({
        mint,
        sharingConfig,
        sharingConfigAddress,
        quoteMint: NATIVE_MINT,
        payer: payer.publicKey,
        shouldInitializeAta: true,
        quoteTokenProgram: TOKEN_PROGRAM_ID,
      }),
    );

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    const sig = await conn.sendTransaction(tx, [payer]);
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return { ok: true, note: `distributed ~${vaultSol.toFixed(5)} SOL across ${sharingConfig.shareholders.length} shareholder(s)`, txSig: sig };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "distribute error" };
  }
}

/** Helper for callers that hold a raw LAUNCH_SIGNER_SECRET env value. */
export function loadLaunchSignerSecret(raw: string | undefined): Uint8Array | null {
  const arr = parseSecretKeyJson(raw);
  return arr ? Uint8Array.from(arr) : null;
}
