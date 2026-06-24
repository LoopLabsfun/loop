// Distribute LOOP's accrued AGENT + PLATFORM fee shares out of the custodial
// creator wallet into their own wallets — making the 30/65/5 split REAL money
// movement, not just the fee_ledger accounting. The founder share is left in the
// creator==treasury wallet (already where it belongs for LOOP).
//
//   set -a; source .env.local; set +a
//   # plan only (read-only — signs/sends NOTHING):
//   npx tsx scripts/distribute-fees.ts
//   # execute for real (signs + broadcasts mainnet SOL transfers):
//   FEE_DISTRIBUTE=1 npx tsx scripts/distribute-fees.ts --execute
//
// Requires: SUPABASE_SERVICE_ROLE_KEY, LAUNCH_SIGNER_SECRET (the creator wallet
// that holds the swept fees), HELIUS_API_KEY, and PLATFORM_WALLET (the 5% cut
// destination). The agent wallet is read from the project row. The signer pubkey
// MUST match the project's treasury/creator wallet — else the script aborts (it
// never sends from an unexpected wallet). Node ≥ 20 (nvm use 23).
import { createClient } from "@supabase/supabase-js";
import { planFeeDistribution } from "../lib/fee-distribute";
import { parseSecretKeyJson } from "../lib/vanity";

const KEY = "loop";
const EXECUTE = process.argv.includes("--execute");

function envNum(name: string, def: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
}

(async () => {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: proj } = await sb.from("projects").select("*").eq("key", KEY).maybeSingle();
  if (!proj) throw new Error(`project ${KEY} not found`);
  const treasuryWallet = (proj.treasury_wallet ?? proj.creator_wallet) as string | undefined;
  const agentWallet = proj.agent_wallet as string | undefined;
  const platformWallet = process.env.PLATFORM_WALLET;

  const { data: ledger } = await sb
    .from("fee_ledger")
    .select("*")
    .eq("project_key", KEY)
    .maybeSingle();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const claimableAgentSol = num(ledger?.earned_agent_sol) - num(ledger?.claimed_agent_sol);
  const claimablePlatformSol = num(ledger?.earned_platform_sol) - num(ledger?.claimed_platform_sol);

  const plan = planFeeDistribution({
    claimableAgentSol,
    claimablePlatformSol,
    agentWallet,
    platformWallet,
    minTransferSol: envNum("FEE_MIN_TRANSFER_SOL", 0.001),
  });

  console.log(`\nFee distribution plan for ${KEY}:`);
  console.log(`  claimable  agent=${claimableAgentSol} SOL · platform=${claimablePlatformSol} SOL`);
  console.log(`  agentWallet=${agentWallet ?? "—"}  platformWallet=${platformWallet ?? "—"}`);
  for (const t of plan.transfers) console.log(`  → ${t.role}: ${t.sol} SOL → ${t.to}`);
  for (const s of plan.skipped) console.log(`  · skipped ${s}`);
  console.log(`  total to move: ${plan.totalSol} SOL`);

  if (!EXECUTE) {
    console.log(`\n(dry-run — nothing signed or sent. Re-run with --execute to broadcast.)`);
    return;
  }
  if (process.env.FEE_DISTRIBUTE !== "1") {
    throw new Error("Refusing to execute: set FEE_DISTRIBUTE=1 to arm real transfers.");
  }
  if (!plan.transfers.length) {
    console.log(`\nNothing to send.`);
    return;
  }

  const secret = parseSecretKeyJson(process.env.LAUNCH_SIGNER_SECRET ?? "");
  if (!secret) throw new Error("LAUNCH_SIGNER_SECRET must be a 64-byte JSON array.");
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) throw new Error("HELIUS_API_KEY required to broadcast.");

  const { Keypair, Connection, SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } =
    await import("@solana/web3.js");
  const signer = Keypair.fromSecretKey(Uint8Array.from(secret));

  // Safety bolt: only ever send from the project's own treasury/creator wallet.
  if (treasuryWallet && signer.publicKey.toBase58() !== treasuryWallet) {
    throw new Error(
      `signer ${signer.publicKey.toBase58()} != treasury/creator ${treasuryWallet} — aborting.`
    );
  }

  const conn = new Connection(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, "confirmed");

  for (const t of plan.transfers) {
    const lamports = Math.round(t.sol * LAMPORTS_PER_SOL);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new PublicKey(t.to),
        lamports,
      })
    );
    const sig = await conn.sendTransaction(tx, [signer]);
    const latest = await conn.getLatestBlockhash();
    await conn.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed"
    );
    console.log(`  ✓ sent ${t.sol} SOL to ${t.role} (${t.to}) · ${sig}`);

    // Record the disbursement as "claimed" so it isn't sent twice.
    const col = t.role === "agent" ? "claimed_agent_sol" : "claimed_platform_sol";
    const prev = num((ledger as Record<string, unknown> | null)?.[col]);
    await sb
      .from("fee_ledger")
      .update({ [col]: prev + t.sol, updated_at: new Date().toISOString() })
      .eq("project_key", KEY);
  }

  console.log(`\nDone — distributed ${plan.totalSol} SOL.`);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
