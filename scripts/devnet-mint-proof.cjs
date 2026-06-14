// Proof: mint a real SPL token on devnet, fully autonomously (no secrets).
//
// Sustainable across runs: persists its keypair to scripts/.devnet-keypair.json
// (gitignored) and reuses it, so the 1-SOL/day devnet faucet allowance isn't
// wasted on a throwaway key. Only airdrops when the balance is too low to mint;
// minting itself costs ~0.002 SOL, so one successful airdrop funds many runs.
//
// Run:           node scripts/devnet-mint-proof.cjs
// Custom RPC:    DEVNET_RPC="https://devnet.helius-rpc.com/?api-key=…" node scripts/devnet-mint-proof.cjs
const fs = require("fs");
const path = require("path");
const {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} = require("@solana/web3.js");
const { createMint } = require("@solana/spl-token");

const KEYPAIR_PATH = path.join(__dirname, ".devnet-keypair.json");
const MIN_SOL = 0.05; // enough headroom over rent for a mint
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadOrCreateKeypair() {
  try {
    const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8"));
    return { kp: Keypair.fromSecretKey(Uint8Array.from(raw)), reused: true };
  } catch {
    const kp = Keypair.generate();
    fs.writeFileSync(KEYPAIR_PATH, JSON.stringify([...kp.secretKey]));
    return { kp, reused: false };
  }
}

async function airdrop(conn, pubkey, sol) {
  for (let i = 1; i <= 5; i++) {
    try {
      const sig = await conn.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
      const bh = await conn.getLatestBlockhash();
      await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      return sig;
    } catch (e) {
      console.log(`  airdrop attempt ${i} failed: ${e.message.split("\n")[0]}`);
      await sleep(2000);
    }
  }
  return null;
}

(async () => {
  const endpoint = process.env.DEVNET_RPC || clusterApiUrl("devnet");
  const conn = new Connection(endpoint, "confirmed");
  const { kp: payer, reused } = loadOrCreateKeypair();
  console.log("endpoint:", endpoint.replace(/api-key=[^&]*/, "api-key=***"));
  console.log(`payer:    ${payer.publicKey.toBase58()} (${reused ? "reused" : "new"})`);

  let bal = (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
  console.log("balance: ", bal, "SOL");

  if (bal < MIN_SOL) {
    console.log(`balance below ${MIN_SOL} SOL — requesting airdrop (1 SOL)…`);
    const sig = await airdrop(conn, payer.publicKey, 1);
    if (!sig) {
      console.error(
        "AIRDROP UNAVAILABLE: devnet faucet rate-limited/dry (1 SOL per project per day).\n" +
          "The keypair is persisted — re-run later, or fund it manually at https://faucet.solana.com :\n" +
          `  ${payer.publicKey.toBase58()}`
      );
      process.exit(2);
    }
    bal = (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
    console.log("funded:  ", bal, "SOL");
  }

  console.log("creating SPL mint (9 decimals)…");
  const mint = await createMint(conn, payer, payer.publicKey, payer.publicKey, 9);
  console.log("MINT:", mint.toBase58());
  console.log(
    `explorer: https://explorer.solana.com/address/${mint.toBase58()}?cluster=devnet`
  );
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
