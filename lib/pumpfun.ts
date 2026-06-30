import "server-only";

import type { LaunchCluster } from "./launchpad";

// Launch a token on pump.fun via PumpPortal, with a vanity mint (every CA ends
// in MINT_VANITY_SUFFIX, e.g. "Loop"). The "pump" suffix on pump.fun tokens is
// just their client grinding it — the create call accepts ANY mint keypair, so
// we pass one from our pre-ground "Loop" pool and get pump.fun's bonding curve
// AND a "…Loop" address.
//
// Non-custodial (Local) flow, consistent with the SPL path's LAUNCH_SIGNER_SECRET:
//   1. claim a vanity keypair (lib/vanity) — fail-closed, same "…Loop" guarantee
//   2. upload token metadata to pump.fun IPFS  → metadata URI
//   3. ask PumpPortal /trade-local to build the create tx (payer = our signer)
//   4. sign with [signer, mint] and submit to the mainnet RPC
//
// ⚠️ pump.fun is MAINNET-ONLY (no devnet) and this spends real SOL, so it is
// NOT exercised in CI — smoke-test with a small real launch before relying on it.
// Heavy Solana libs are imported dynamically (server-bundle hygiene). Server-only.

import { parseSecretKeyJson } from "./vanity";
import { privySignSolanaTx } from "./agent-wallet";

const IPFS_URL = "https://pump.fun/api/ipfs";
const PUMPPORTAL_LOCAL = "https://pumpportal.fun/api/trade-local";
// 1×1 transparent PNG — a valid placeholder logo until the agent sets a real one.
const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAACd / vDIAAAAASUVORK5CYII=".replace(
    / /g,
    ""
  );

export interface PumpfunCreateInput {
  name: string;
  symbol: string; // bare ticker, no leading "$"
  description: string;
  suffix?: string; // vanity suffix; defaults to MINT_VANITY_SUFFIX
  /** Optional real logo; falls back to a transparent placeholder. */
  logo?: { bytes: Uint8Array; filename: string; contentType: string };
  /** Social/site links shown on pump.fun + carried into DexScreener token info. */
  links?: { website?: string; twitter?: string; telegram?: string };
  /** Dev-buy in SOL, executed atomically with create (0 = create only, no buy). */
  devBuySol?: number;
}

export interface PumpfunCreateResult {
  mint: string;
  treasuryWallet: string; // our launch signer (creator)
  txSig: string;
}

/** Pure: the PumpPortal /trade-local create payload. */
export function buildCreatePayload(args: {
  publicKey: string;
  mint: string;
  metadataUri: string;
  name: string;
  symbol: string;
  /** Dev-buy in SOL at creation (0 = create only). Clamped non-negative. */
  amountSol?: number;
}) {
  return {
    publicKey: args.publicKey,
    action: "create" as const,
    tokenMetadata: { name: args.name, symbol: args.symbol, uri: args.metadataUri },
    mint: args.mint,
    denominatedInSol: "true" as const,
    amount: Math.max(0, args.amountSol ?? 0), // dev-buy in SOL (0 = none)
    slippage: 10,
    priorityFee: 0.0005,
    pool: "pump" as const,
  };
}

async function uploadMetadata(input: PumpfunCreateInput): Promise<string> {
  const form = new FormData();
  const logo = input.logo;
  const fileBytes = logo ? logo.bytes : Buffer.from(PLACEHOLDER_PNG_BASE64, "base64");
  const fileType = logo ? logo.contentType : "image/png";
  const fileName = logo ? logo.filename : "logo.png";
  form.append("file", new Blob([fileBytes], { type: fileType }), fileName);
  form.append("name", input.name);
  form.append("symbol", input.symbol);
  form.append("description", input.description);
  if (input.links?.twitter) form.append("twitter", input.links.twitter);
  if (input.links?.telegram) form.append("telegram", input.links.telegram);
  if (input.links?.website) form.append("website", input.links.website);
  form.append("showName", "true");
  const res = await fetch(IPFS_URL, { method: "POST", body: form });
  if (!res.ok) throw new Error(`pump.fun IPFS upload failed (${res.status}).`);
  const json = (await res.json()) as { metadataUri?: string };
  if (!json.metadataUri) throw new Error("pump.fun IPFS returned no metadataUri.");
  return json.metadataUri;
}

export async function createOnPumpPortal(
  input: PumpfunCreateInput,
  cluster: LaunchCluster
): Promise<PumpfunCreateResult> {
  if (cluster !== "mainnet") {
    throw new Error("pump.fun is mainnet-only; cannot launch on devnet.");
  }
  const signerSecret = process.env.LAUNCH_SIGNER_SECRET;
  if (!signerSecret) {
    throw new Error("pump.fun launch needs LAUNCH_SIGNER_SECRET (the creator wallet).");
  }
  const suffix = input.suffix ?? process.env.MINT_VANITY_SUFFIX;

  const { Keypair, Connection, VersionedTransaction } = await import("@solana/web3.js");

  // 1) vanity mint keypair (fail-closed when a suffix is configured)
  let mintKeypair: import("@solana/web3.js").Keypair;
  if (suffix) {
    const { nextVanityKeypair } = await import("./vanity");
    const vanity = await nextVanityKeypair(suffix, cluster);
    if (!vanity) {
      throw new Error(
        `Vanity pool for "${suffix}" is empty — refusing to launch a non-"${suffix}" address.`
      );
    }
    mintKeypair = vanity;
  } else {
    mintKeypair = Keypair.generate();
  }

  const signerBytes = parseSecretKeyJson(signerSecret);
  if (!signerBytes) throw new Error("LAUNCH_SIGNER_SECRET must be a 64-byte JSON array.");
  const signer = Keypair.fromSecretKey(Uint8Array.from(signerBytes));

  // 2) metadata → URI
  const metadataUri = await uploadMetadata(input);

  const endpoint = process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com";
  const conn = new Connection(endpoint, "confirmed");
  const creator = signer.publicKey.toBase58();
  const mint = mintKeypair.publicKey.toBase58();
  const devBuy = Math.max(0, input.devBuySol ?? 0);

  // 3) CREATE — a single tx, the commit point. Signed [signer, mint], submitted
  // via our RPC and confirmed ourselves (no Jito bundle: it was rejected on
  // mainnet — low/absent tip via the trade-local flow — and a bundle has no safe
  // retry). PumpPortal's non-custodial create rejects amount > 0, so the dev-buy
  // is a SEPARATE buy below, not bundled.
  const createRes = await fetch(PUMPPORTAL_LOCAL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      buildCreatePayload({ publicKey: creator, mint, metadataUri, name: input.name, symbol: input.symbol })
    ),
  });
  if (!createRes.ok) {
    throw new Error(`PumpPortal create failed (${createRes.status}): ${await createRes.text()}`);
  }
  const createTx = VersionedTransaction.deserialize(new Uint8Array(await createRes.arrayBuffer()));
  createTx.sign([signer, mintKeypair]);
  const sig = await conn.sendTransaction(createTx);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");

  // 4) DEV-BUY (the first candle) — a separate buy from the same signer.
  // Best-effort: the token already exists, so a failed buy is retryable and
  // never unwinds the mint (approve treats the create above as the commit point).
  // Trade-off: not atomic with the create, so a tiny snipe window exists — fine
  // for a fresh unknown token with a small seed candle.
  if (devBuy > 0) {
    try {
      const buyRes = await fetch(PUMPPORTAL_LOCAL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: creator,
          action: "buy",
          mint,
          denominatedInSol: "true",
          amount: devBuy,
          slippage: 10,
          priorityFee: 0.0005,
          pool: "pump",
        }),
      });
      if (buyRes.ok) {
        const buyTx = VersionedTransaction.deserialize(new Uint8Array(await buyRes.arrayBuffer()));
        buyTx.sign([signer]);
        await conn.sendTransaction(buyTx);
      }
    } catch {
      /* token exists; a failed dev-buy is retryable — never roll back the mint */
    }
  }

  return { mint, treasuryWallet: creator, txSig: sig };
}

/**
 * Create a pump.fun token whose ON-CHAIN CREATOR is the project's Loop-custodial
 * Privy wallet (so it — not the shared platform signer — owns the creator fees and
 * IS the treasury). PumpPortal returns the unsigned create tx; we add the vanity
 * mint keypair's signature, then Privy signs (as payer/creator) and broadcasts. The
 * dev-buy candle is a SEPARATE, post-create buy from the same wallet (best-effort —
 * the mint is the commit point, a failed buy never rolls it back). Mainnet-only; real SOL.
 *
 * Signing order (safest, docs-grounded): Privy signs the UNSIGNED tx (its own payer
 * slot only) → we add the vanity mint's signature locally (web3.js preserves Privy's)
 * → we broadcast via our RPC and control confirmation. So Privy never has to preserve
 * a pre-existing signature. Still flag-gated: validate with one real test-launch.
 */
export async function createOnPumpPortalWithPrivy(
  input: PumpfunCreateInput,
  cluster: LaunchCluster,
  privy: { walletId: string; address: string }
): Promise<PumpfunCreateResult> {
  if (cluster !== "mainnet") {
    throw new Error("pump.fun is mainnet-only; cannot launch on devnet.");
  }
  const suffix = input.suffix ?? process.env.MINT_VANITY_SUFFIX;
  const { Keypair, Connection, VersionedTransaction } = await import("@solana/web3.js");

  // 1) vanity mint keypair (fail-closed when a suffix is configured)
  let mintKeypair: import("@solana/web3.js").Keypair;
  if (suffix) {
    const { nextVanityKeypair } = await import("./vanity");
    const vanity = await nextVanityKeypair(suffix, cluster);
    if (!vanity) {
      throw new Error(`Vanity pool for "${suffix}" is empty — refusing to launch a non-"${suffix}" address.`);
    }
    mintKeypair = vanity;
  } else {
    mintKeypair = Keypair.generate();
  }

  const metadataUri = await uploadMetadata(input);
  const endpoint = process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com";
  const conn = new Connection(endpoint, "confirmed");
  const mint = mintKeypair.publicKey.toBase58();
  const devBuy = Math.max(0, input.devBuySol ?? 0);

  // 2) CREATE — creator/payer = the project's Privy wallet. Add the mint sig, then
  // Privy signs (payer) + broadcasts.
  const createRes = await fetch(PUMPPORTAL_LOCAL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      buildCreatePayload({ publicKey: privy.address, mint, metadataUri, name: input.name, symbol: input.symbol })
    ),
  });
  if (!createRes.ok) {
    throw new Error(`PumpPortal create failed (${createRes.status}): ${await createRes.text()}`);
  }
  // Privy signs the unsigned tx (its payer slot) → we add the mint sig locally
  // (web3.js leaves Privy's signature intact) → we broadcast + confirm ourselves.
  const unsignedCreateB64 = Buffer.from(new Uint8Array(await createRes.arrayBuffer())).toString("base64");
  const privySignedB64 = await privySignSolanaTx(privy.walletId, unsignedCreateB64);
  const createTx = VersionedTransaction.deserialize(Buffer.from(privySignedB64, "base64"));
  createTx.sign([mintKeypair]);
  const createSig = await conn.sendRawTransaction(createTx.serialize());

  // Confirm by polling the mint account (present ⇒ create landed). No blind retry.
  const start = Date.now();
  let landed = false;
  while (Date.now() - start < 60_000) {
    await new Promise((r) => setTimeout(r, 2500));
    if (await conn.getAccountInfo(mintKeypair.publicKey, "confirmed")) {
      landed = true;
      break;
    }
  }
  if (!landed) {
    throw new Error(
      `Create submitted but mint ${mint} not seen on-chain after 60s. DO NOT re-run blindly — check https://pump.fun/coin/${mint} and the project wallet first.`
    );
  }

  // 3) DEV-BUY (the first candle) — a separate buy from the same wallet. Best-effort:
  // the token already exists, so a failed buy is retryable and never rolls back the mint.
  if (devBuy > 0) {
    try {
      const buyRes = await fetch(PUMPPORTAL_LOCAL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: privy.address,
          action: "buy",
          mint,
          denominatedInSol: "true",
          amount: devBuy,
          slippage: 10,
          priorityFee: 0.0005,
          pool: "pump",
        }),
      });
      if (buyRes.ok) {
        const unsignedBuyB64 = Buffer.from(new Uint8Array(await buyRes.arrayBuffer())).toString("base64");
        const buySignedB64 = await privySignSolanaTx(privy.walletId, unsignedBuyB64);
        const buyTx = VersionedTransaction.deserialize(Buffer.from(buySignedB64, "base64"));
        await conn.sendRawTransaction(buyTx.serialize());
      }
    } catch {
      /* token exists; a failed dev-buy is retryable — never roll back the mint */
    }
  }

  return { mint, treasuryWallet: privy.address, txSig: createSig };
}
