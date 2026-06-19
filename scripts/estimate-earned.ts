// READ-ONLY. Estimate LOOP's real "Total earned" (creator fees) from on-chain
// data so we can seed projects.earned_sol honestly. Derives the creator wallet
// from LAUNCH_SIGNER_SECRET (the pump.fun coin creator that fee claims pay), then
// sums the SOL that wallet has received over its lifetime, alongside the treasury
// and agent wallet balances for context. Signs nothing.
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/estimate-earned.ts
//
// Needs Node ≥ 20 (global fetch). Run with: nvm use 22 (or 23).

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const TREASURY = "7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9";
const AGENT = "5Fk6yGjCWsUYB2NAA4uo8WaqXh6WGZoxxaz85PYJXwRV";

function endpoint(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error("HELIUS_API_KEY missing");
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

function creatorPubkey(): PublicKey {
  const raw = process.env.LAUNCH_SIGNER_SECRET;
  if (!raw) throw new Error("LAUNCH_SIGNER_SECRET missing");
  const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
  return Keypair.fromSecretKey(bytes).publicKey;
}

async function balanceSol(conn: Connection, addr: string): Promise<number> {
  return (await conn.getBalance(new PublicKey(addr))) / LAMPORTS_PER_SOL;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sum the SOL this account RECEIVED across its history (positive native balance
// deltas), and what it SENT (negative). Received ≈ funding + claimed creator
// fees; sent ≈ buybacks + tx fees + transfers out. Uses staticAccountKeys (the
// wallet is the signer/fee-payer, always static) so ALT lookups don't matter,
// and paces calls to dodge the RPC rate limit.
async function flows(conn: Connection, addr: string) {
  const pk = new PublicKey(addr);
  const page = await conn.getSignaturesForAddress(pk, { limit: 1000 });
  let received = 0;
  let sent = 0;
  let counted = 0;
  // Fee claims = txs the wallet ITSELF signs (fee payer, static index 0) that net
  // positive SOL — i.e. it collected its own pump.fun creator fees. This excludes
  // external funding (where someone else signs and sends in) and self-initiated
  // spends (buybacks net negative). The honest "earned" proxy.
  let selfClaimed = 0;
  let selfClaimCount = 0;
  for (const s of page) {
    const tx = await conn.getTransaction(s.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    await sleep(120);
    if (!tx?.meta) continue;
    const keys = tx.transaction.message.staticAccountKeys;
    const idx = keys.findIndex((k) => k.equals(pk));
    if (idx < 0) continue; // wallet only referenced via an ALT — not a balance change we own
    const delta = (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / LAMPORTS_PER_SOL;
    if (delta > 0) received += delta;
    else sent += -delta;
    if (idx === 0 && delta > 0) {
      selfClaimed += delta;
      selfClaimCount++;
    }
    counted++;
  }
  return { signatures: page.length, counted, received, sent, selfClaimed, selfClaimCount };
}

async function main() {
  const conn = new Connection(endpoint(), "confirmed");
  const creator = creatorPubkey();
  console.log("creator (launch signer):", creator.toBase58());
  console.log("treasury:", TREASURY);
  console.log("agent:   ", AGENT);
  console.log("");

  const [cBal, tBal, aBal] = await Promise.all([
    balanceSol(conn, creator.toBase58()),
    balanceSol(conn, TREASURY),
    balanceSol(conn, AGENT),
  ]);
  console.log("balances (SOL):", { creator: cBal, treasury: tBal, agent: aBal });
  console.log("");

  // creator === treasury for LOOP, so measure the treasury once.
  const f = await flows(conn, TREASURY);
  console.log("treasury flows:", f);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
