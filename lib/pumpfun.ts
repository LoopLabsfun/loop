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
}) {
  return {
    publicKey: args.publicKey,
    action: "create" as const,
    tokenMetadata: { name: args.name, symbol: args.symbol, uri: args.metadataUri },
    mint: args.mint,
    denominatedInSol: "true" as const,
    amount: 0, // no dev-buy
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

  // 3) build the create tx via PumpPortal (non-custodial)
  const payload = buildCreatePayload({
    publicKey: signer.publicKey.toBase58(),
    mint: mintKeypair.publicKey.toBase58(),
    metadataUri,
    name: input.name,
    symbol: input.symbol,
  });
  const res = await fetch(PUMPPORTAL_LOCAL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`PumpPortal create failed (${res.status}).`);
  const txBytes = new Uint8Array(await res.arrayBuffer());

  // 4) sign with [signer, mint] and submit to mainnet
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([signer, mintKeypair]);
  const endpoint = process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com";
  const conn = new Connection(endpoint, "confirmed");
  const sig = await conn.sendTransaction(tx);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");

  return {
    mint: mintKeypair.publicKey.toBase58(),
    treasuryWallet: signer.publicKey.toBase58(),
    txSig: sig,
  };
}
