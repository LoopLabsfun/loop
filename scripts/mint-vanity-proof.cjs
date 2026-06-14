const fs = require("fs");
const path = require("path");
const { Connection, Keypair, clusterApiUrl } = require("@solana/web3.js");
const { createMint } = require("@solana/spl-token");
(async () => {
  const conn = new Connection(process.env.DEVNET_RPC || clusterApiUrl("devnet"), "confirmed");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync(path.join(__dirname, ".devnet-keypair.json"), "utf8"))));
  // the ground vanity keypair (pubkey ends in "Loop")
  const poolDir = path.join(__dirname, ".vanity-pool");
  const file = fs.readdirSync(poolDir).find(f => f.endsWith("Loop.json"));
  const mintKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(
    fs.readFileSync(path.join(poolDir, file), "utf8"))));
  console.log("vanity mint target:", mintKp.publicKey.toBase58());
  const mint = await createMint(conn, payer, payer.publicKey, payer.publicKey, 6, mintKp);
  console.log("MINTED CA:", mint.toBase58());
  console.log("ends with Loop:", mint.toBase58().endsWith("Loop"));
  console.log(`explorer: https://explorer.solana.com/address/${mint.toBase58()}?cluster=devnet`);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
