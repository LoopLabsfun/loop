// Mint a real $LOOP token on devnet WITH supply, using the persisted (funded)
// keypair as mint authority + holder. Produces a token to test stake
// verification against (lib/stake.ts).
//
// Run: DEVNET_RPC="https://devnet.helius-rpc.com/?api-key=…" node scripts/devnet-mint-loop.cjs
const fs = require("fs");
const path = require("path");
const {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} = require("@solana/web3.js");
const {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
} = require("@solana/spl-token");

const KEYPAIR_PATH = path.join(__dirname, ".devnet-keypair.json");
const DECIMALS = 6;
const SUPPLY = 1_000_000; // 1,000,000 LOOP

(async () => {
  const endpoint = process.env.DEVNET_RPC || clusterApiUrl("devnet");
  const conn = new Connection(endpoint, "confirmed");
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")))
  );
  console.log("payer:", payer.publicKey.toBase58());
  const bal = (await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL;
  console.log("balance:", bal, "SOL");

  console.log("creating $LOOP mint (6 decimals)…");
  const mint = await createMint(conn, payer, payer.publicKey, payer.publicKey, DECIMALS);
  console.log("LOOP MINT:", mint.toBase58());

  const ata = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  console.log("holder ATA:", ata.address.toBase58());

  console.log(`minting ${SUPPLY.toLocaleString()} LOOP…`);
  await mintTo(conn, payer, mint, ata.address, payer, SUPPLY * 10 ** DECIMALS);

  const info = await getMint(conn, mint);
  console.log("supply:", Number(info.supply) / 10 ** DECIMALS, "LOOP");
  console.log(
    `explorer: https://explorer.solana.com/address/${mint.toBase58()}?cluster=devnet`
  );
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
