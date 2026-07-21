// READ-ONLY. Sweep every place SOL fees could be hiding for our 4 mainnet
// projects and print what's actually recoverable:
//   1. pump.fun creator vault (bonding-curve + AMM sides, per fee-creator wallet).
//   2. pump.fun fee-sharing config vault (per mint, if opted in).
//   3. Off-chain fee_ledger: earned − claimed, per role, per project (SOL
//      already-swept-but-not-yet-distributed sitting on the treasury wallet).
//   4. SOL sitting on each project's treasury_wallet and fee_creator_wallet.
//
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/check-fees.ts
//
// Node ≥ 20.

import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { OnlinePumpSdk, feeSharingConfigPda } from "@pump-fun/pump-sdk";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface Project {
  key: string;
  name: string;
  network: string;
  mint: string | null;
  treasury_wallet: string | null;
  fee_creator_wallet: string | null;
}

async function projects(): Promise<Project[]> {
  const r = await fetch(
    `${url}/rest/v1/projects?select=key,name,network,mint,treasury_wallet,fee_creator_wallet&order=created_at.asc`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } }
  );
  return (await r.json()) as Project[];
}

interface LedgerRow {
  project_key: string;
  earned_founder_sol: number;
  earned_agent_sol: number;
  earned_platform_sol: number;
  claimed_founder_sol: number;
  claimed_agent_sol: number;
  claimed_platform_sol: number;
}

async function ledgers(): Promise<Record<string, LedgerRow>> {
  const r = await fetch(
    `${url}/rest/v1/fee_ledger?select=project_key,earned_founder_sol,earned_agent_sol,earned_platform_sol,claimed_founder_sol,claimed_agent_sol,claimed_platform_sol`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } }
  );
  const rows = (await r.json()) as LedgerRow[];
  return Object.fromEntries(rows.map((row) => [row.project_key, row]));
}

const fmt = (n: number) => n.toFixed(6);

async function main() {
  const rows = (await projects()).filter((p) => p.network === "mainnet" && p.fee_creator_wallet);
  const led = await ledgers();

  const endpoint = process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com";
  const conn = new Connection(endpoint, "confirmed");
  const sdk = new OnlinePumpSdk(conn);

  // 1) Pump.fun creator vault (bonding-curve + AMM), grouped by unique fee-creator
  // wallet — a single vault holds all fees for every coin sharing a creator.
  const byCreator = new Map<string, Project[]>();
  for (const p of rows) {
    const c = p.fee_creator_wallet!;
    if (!byCreator.has(c)) byCreator.set(c, []);
    byCreator.get(c)!.push(p);
  }

  console.log("── 1. Pump.fun CREATOR VAULT (bonding-curve + AMM) ─────────────\n");
  let vaultTotal = 0;
  for (const [creator, ps] of Array.from(byCreator)) {
    const bal = await sdk.getCreatorVaultBalanceBothPrograms(new PublicKey(creator));
    const sol = bal.toNumber() / LAMPORTS_PER_SOL;
    vaultTotal += sol;
    console.log(`  ${creator}`);
    console.log(`    projects: ${ps.map((p) => p.name).join(" + ")}`);
    console.log(`    unclaimed: ${fmt(sol)} SOL`);
    console.log("");
  }
  console.log(`  subtotal: ${fmt(vaultTotal)} SOL\n`);

  // 2) Fee-sharing config vault per mint (opt-in). If the sharing-config PDA
  // doesn't exist for a mint, that project never opted into pump.fun's native
  // multi-recipient fee-sharing → skip. Otherwise, its own vault sits under the
  // sharing-config address (see lib/pump-fee-sharing.ts:202).
  console.log("── 2. Fee-sharing config VAULT (per mint, opt-in) ──────────────\n");
  let shareTotal = 0;
  for (const p of rows) {
    if (!p.mint) continue;
    const cfg = feeSharingConfigPda(new PublicKey(p.mint));
    const info = await conn.getAccountInfo(cfg);
    if (!info) {
      console.log(`  ${p.name}: no sharing config (fee-sharing dormant)`);
      continue;
    }
    const bal = await sdk.getCreatorVaultBalanceBothPrograms(cfg);
    const sol = bal.toNumber() / LAMPORTS_PER_SOL;
    shareTotal += sol;
    console.log(`  ${p.name}: ${fmt(sol)} SOL in sharing-config vault`);
  }
  console.log(`\n  subtotal: ${fmt(shareTotal)} SOL\n`);

  // 3) Off-chain fee_ledger — SOL already claimed by the agent and split
  // 30/65/5, but still sitting on the treasury wallet waiting to be paid out to
  // founder / agent / platform. (earned − claimed per role.)
  console.log("── 3. Off-chain fee_ledger (earned − claimed) ──────────────────\n");
  let ledgerTotal = 0;
  for (const p of rows) {
    const row = led[p.key];
    if (!row) {
      console.log(`  ${p.name}: no ledger row`);
      continue;
    }
    const fCl = Math.max(0, row.earned_founder_sol - row.claimed_founder_sol);
    const aCl = Math.max(0, row.earned_agent_sol - row.claimed_agent_sol);
    const pCl = Math.max(0, row.earned_platform_sol - row.claimed_platform_sol);
    const sum = fCl + aCl + pCl;
    ledgerTotal += sum;
    console.log(`  ${p.name}: founder ${fmt(fCl)} · agent ${fmt(aCl)} · platform ${fmt(pCl)} = ${fmt(sum)} SOL`);
  }
  console.log(`\n  subtotal: ${fmt(ledgerTotal)} SOL\n`);

  // 4) Raw SOL sitting on treasury + fee-creator wallets (context, not "fees" —
  // some of this is the treasury itself). Included so a stranded balance can't
  // hide behind the fee accounting.
  console.log("── 4. Wallet balances (context) ────────────────────────────────\n");
  const wallets = new Set<string>();
  for (const p of rows) {
    if (p.treasury_wallet) wallets.add(p.treasury_wallet);
    if (p.fee_creator_wallet) wallets.add(p.fee_creator_wallet);
  }
  for (const w of Array.from(wallets)) {
    const bal = await conn.getBalance(new PublicKey(w));
    const owners = rows
      .filter((p) => p.treasury_wallet === w || p.fee_creator_wallet === w)
      .map((p) => {
        const roles: string[] = [];
        if (p.treasury_wallet === w) roles.push("treasury");
        if (p.fee_creator_wallet === w) roles.push("fee-creator");
        return `${p.name}(${roles.join("+")})`;
      })
      .join(", ");
    console.log(`  ${w}  ${fmt(bal / LAMPORTS_PER_SOL)} SOL  ← ${owners}`);
  }

  console.log("\n────────────────────────────────────────────────────────────────");
  console.log(`ON-CHAIN RECOVERABLE (1 + 2): ${fmt(vaultTotal + shareTotal)} SOL`);
  console.log(`OFF-CHAIN OWED via ledger  (3): ${fmt(ledgerTotal)} SOL`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
