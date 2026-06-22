// One-off: sweep EVERYTHING from a project's Privy-custodied agent wallet to a
// destination address. Signs + broadcasts via Privy (raw key never leaves Privy).
//
// Order: (1) Token-2022 mint move — create dest ATA if missing, transfer the full
// $LOOP balance, then close the source token account to reclaim its rent to the
// agent; (2) sweep the remaining SOL (balance − exact network fee) to the dest.
//
// Run:
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/sweep-agent-wallet.ts <projectKey> <destAddress>
import {
  getAgentWallet,
  agentWalletConfigured,
  privySignAndSendSolanaTx,
} from "../lib/agent-wallet";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createCloseAccountInstruction,
} from "@solana/spl-token";

const KEY = process.argv[2] || "loop";
const DEST = process.argv[3];
const MINT = "1HzvfoqESQMaRz7hBYpAYNutp4kdXSZnB3HCfFNLoop";

function rpc(): string {
  const k = process.env.HELIUS_API_KEY;
  if (!k) throw new Error("HELIUS_API_KEY not set.");
  return `https://mainnet.helius-rpc.com/?api-key=${k}`;
}

async function build(
  conn: Connection,
  payer: PublicKey,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instructions: any[]
): Promise<{ b64: string; blockhash: string; lastValidBlockHeight: number }> {
  const bh = await conn.getLatestBlockhash("finalized");
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: bh.blockhash,
    instructions,
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);
  return {
    b64: Buffer.from(vtx.serialize()).toString("base64"),
    blockhash: bh.blockhash,
    lastValidBlockHeight: bh.lastValidBlockHeight,
  };
}

(async () => {
  if (!DEST) throw new Error("Usage: sweep-agent-wallet.ts <projectKey> <destAddress>");
  if (!agentWalletConfigured()) throw new Error("PRIVY_APP_ID / PRIVY_APP_SECRET not set.");

  const wallet = await getAgentWallet(KEY);
  if (!wallet) throw new Error(`No Privy agent wallet for project "${KEY}".`);

  const agent = new PublicKey(wallet.address);
  const dest = new PublicKey(DEST);
  const mint = new PublicKey(MINT);
  const conn = new Connection(rpc(), "confirmed");

  console.log("project:    ", KEY);
  console.log("agent wallet:", agent.toBase58(), `(privy ${wallet.id})`);
  console.log("destination: ", dest.toBase58());
  console.log("");

  // ── 1) Token-2022 move: create dest ATA, transfer full balance, close source ──
  const srcAta = getAssociatedTokenAddressSync(mint, agent, false, TOKEN_2022_PROGRAM_ID);
  const dstAta = getAssociatedTokenAddressSync(mint, dest, false, TOKEN_2022_PROGRAM_ID);
  const bal = await conn.getTokenAccountBalance(srcAta).catch(() => null);

  if (bal && BigInt(bal.value.amount) > BigInt(0)) {
    const raw = BigInt(bal.value.amount);
    const decimals = bal.value.decimals;
    console.log(`[1/2] moving ${bal.value.uiAmountString} $LOOP (raw ${raw}, dec ${decimals})`);
    const ix = [
      createAssociatedTokenAccountIdempotentInstruction(
        agent, dstAta, dest, mint, TOKEN_2022_PROGRAM_ID
      ),
      createTransferCheckedInstruction(
        srcAta, mint, dstAta, agent, raw, decimals, [], TOKEN_2022_PROGRAM_ID
      ),
      createCloseAccountInstruction(srcAta, agent, agent, [], TOKEN_2022_PROGRAM_ID),
    ];
    const { b64, blockhash, lastValidBlockHeight } = await build(conn, agent, ix);
    const sig = await privySignAndSendSolanaTx(wallet.id, b64, "mainnet");
    console.log("      tx:", sig);
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    console.log("      ✅ token moved + source account closed");
  } else {
    console.log("[1/2] no $LOOP balance — skipping token move");
  }

  // ── 2) Sweep remaining SOL (balance − exact fee) ──
  // small settle pause so the reclaimed rent is reflected
  await new Promise((r) => setTimeout(r, 2500));
  const lamports = await conn.getBalance(agent, "confirmed");
  console.log(`[2/2] agent SOL balance: ${lamports} lamports (${(lamports / 1e9).toFixed(9)} SOL)`);

  // fee is amount-independent; probe it with a placeholder, then sweep balance − fee
  const probeBh = await conn.getLatestBlockhash("finalized");
  const probeMsg = new TransactionMessage({
    payerKey: agent,
    recentBlockhash: probeBh.blockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: agent, toPubkey: dest, lamports: 1 })],
  }).compileToV0Message();
  const fee = (await conn.getFeeForMessage(probeMsg, "confirmed")).value ?? 5000;
  const send = lamports - fee;
  console.log(`      fee: ${fee} lamports → sweeping ${send} lamports (${(send / 1e9).toFixed(9)} SOL)`);

  if (send <= 0) {
    console.log("      nothing to sweep after fee — done.");
    return;
  }
  const { b64, blockhash, lastValidBlockHeight } = await build(conn, agent, [
    SystemProgram.transfer({ fromPubkey: agent, toPubkey: dest, lamports: send }),
  ]);
  const sig = await privySignAndSendSolanaTx(wallet.id, b64, "mainnet");
  console.log("      tx:", sig);
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log("      ✅ SOL swept");
  console.log("");
  console.log("done. agent wallet drained to", dest.toBase58());
})().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
