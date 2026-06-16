// MAINNET LOOP LAUNCH — creates the real $LOOP token on pump.fun with a "…Loop"
// CA, then persists the mint to the LOOP project row.
//
// ⚠️ THIS SPENDS REAL SOL AND IS IRREVERSIBLE. It is run by the founder, on an
// explicit decision — never autonomously. It self-aborts unless preflight passes.
//
// Run (after funding the creator wallet — see mainnet-launch-preflight.ts):
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/mainnet-launch-loop.ts [logo.png]
import fs from "fs";
import { Keypair } from "@solana/web3.js";
import { parseSecretKeyJson } from "../lib/vanity";
import { createOnPumpPortal } from "../lib/pumpfun";
import { supabaseAdmin } from "../lib/supabase";

const NAME = process.env.LOOP_NAME || "LOOP";
const SYMBOL = process.env.LOOP_SYMBOL || "LOOP";
const DESCRIPTION =
  process.env.LOOP_DESCRIPTION ||
  "Loop — the autonomous software factory. Markets fund the code; an AI agent builds it.";
const MIN_SOL = 0.03;

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
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set.");
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
  const { count } = await supabaseAdmin
    .from("vanity_keypairs")
    .select("*", { count: "exact", head: true })
    .eq("suffix", process.env.MINT_VANITY_SUFFIX || "Loop")
    .eq("used", false);
  if (!count) throw new Error("no unused …Loop vanity keys in the pool.");

  // optional real logo
  const logoPath = process.argv[2];
  const logo = logoPath
    ? {
        bytes: new Uint8Array(fs.readFileSync(logoPath)),
        filename: logoPath.split("/").pop() || "logo.png",
        contentType: logoPath.endsWith(".jpg") || logoPath.endsWith(".jpeg")
          ? "image/jpeg"
          : "image/png",
      }
    : undefined;

  console.log(`Launching $${SYMBOL} on pump.fun (mainnet) · creator ${signer} · ${bal} SOL`);
  console.log(logo ? `logo: ${logoPath}` : "logo: placeholder (set one later)");

  const res = await createOnPumpPortal(
    { name: NAME, symbol: SYMBOL, description: DESCRIPTION, logo },
    "mainnet"
  );

  console.log("\n🚀 LAUNCHED");
  console.log("mint (CA):", res.mint);
  console.log("creator:", res.treasuryWallet);
  console.log("tx:", res.txSig);
  console.log("pump.fun:", `https://pump.fun/coin/${res.mint}`);
  console.log("solscan:", `https://solscan.io/token/${res.mint}`);

  await supabaseAdmin
    .from("projects")
    .update({
      mint: res.mint,
      treasury_wallet: res.treasuryWallet,
      network: "mainnet",
      launchpad: "Pump.fun",
    })
    .eq("key", "loop");
  console.log("\n✅ persisted mint to the LOOP project row.");
})().catch((e) => {
  console.error("LAUNCH ABORTED:", e.message);
  process.exit(1);
});
