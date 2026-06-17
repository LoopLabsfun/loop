// MAINNET SMOKE LAUNCH — a throwaway token to validate the live pump.fun /
// PumpPortal path end-to-end before the real $LOOP launch. pump.fun is mainnet-
// only and not covered by CI, so this is the one realistic dress rehearsal.
//
// Deliberately minimal blast radius vs. the real launch (mainnet-launch-loop.ts):
//   • NO vanity key      — random mint (never burns a scarce "…Loop" key)
//   • NO DB persist       — does not touch the LOOP project row
//   • NO tweet            — never posts to @looplabsfun
//   • NO dev-buy by default (SMOKE_DEV_BUY_SOL=0) — create-only, cheapest path
//
// ⚠️ STILL SPENDS REAL SOL (pump.fun create fee + priority fee, ~0.02–0.03 SOL),
// and the token is REAL + public — just meant to be abandoned. Run by the
// founder, on an explicit decision, never autonomously.
//
// Run:
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/mainnet-smoke-launch.ts
import { Keypair } from "@solana/web3.js";
import { parseSecretKeyJson } from "../lib/vanity";
import { createOnPumpPortal } from "../lib/pumpfun";

const SYMBOL = process.env.SMOKE_SYMBOL || "SMOKE";
const NAME = process.env.SMOKE_NAME || "Loop Smoke Test";
const DESCRIPTION =
  process.env.SMOKE_DESCRIPTION ||
  "Throwaway token validating the pump.fun launch path. Not the real LOOP.";
// Default 0 = create-only (no buy), the cheapest dress rehearsal. Override to
// also exercise the atomic create+dev-buy Jito-bundle path.
const DEV_BUY = Math.max(0, Number(process.env.SMOKE_DEV_BUY_SOL) || 0);
const MIN_SOL = 0.03 + DEV_BUY;

async function mainnetBalanceSol(pubkey: string): Promise<number | null> {
  const key = process.env.HELIUS_API_KEY;
  const url = key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : "https://api.mainnet-beta.solana.com";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [pubkey] }),
  });
  const json = await res.json();
  const l = json?.result?.value;
  return typeof l === "number" ? l / 1e9 : null;
}

(async () => {
  // ── Preflight (abort before spending) ──
  const secret = process.env.LAUNCH_SIGNER_SECRET;
  const bytes = secret && parseSecretKeyJson(secret);
  if (!bytes) throw new Error("LAUNCH_SIGNER_SECRET not set / invalid.");
  const signer = Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey.toBase58();

  const bal = await mainnetBalanceSol(signer);
  if (bal == null || bal < MIN_SOL) {
    throw new Error(
      `creator ${signer} has ${bal ?? "?"} SOL on mainnet — fund it with ≥ ${MIN_SOL} first.`
    );
  }

  console.log(`Smoke-launching $${SYMBOL} on pump.fun (mainnet) · creator ${signer} · ${bal} SOL`);
  console.log(DEV_BUY > 0 ? `dev-buy: ${DEV_BUY} SOL at creation` : "dev-buy: none (create-only)");
  console.log("mint: RANDOM (no vanity) · persist: NO · tweet: NO\n");

  // suffix: "" → createOnPumpPortal generates a random mint (no vanity claim).
  const res = await createOnPumpPortal(
    { name: NAME, symbol: SYMBOL, description: DESCRIPTION, suffix: "", devBuySol: DEV_BUY },
    "mainnet"
  );

  console.log("🚀 SMOKE LAUNCH OK — the live pump.fun path works.");
  console.log("mint (CA):", res.mint);
  console.log("creator:", res.treasuryWallet);
  console.log("tx:", res.txSig);
  console.log("pump.fun:", `https://pump.fun/coin/${res.mint}`);
  console.log("solscan:", `https://solscan.io/token/${res.mint}`);
  console.log(
    "\nThis was a throwaway — nothing was persisted or tweeted. Abandon the token. " +
      "The real launch is scripts/mainnet-launch-loop.ts."
  );
})().catch((e) => {
  console.error("SMOKE LAUNCH ABORTED:", e.message);
  process.exit(1);
});
