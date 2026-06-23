// Diagnostic: real treasury / fees / buyback / agent-wallet state for LOOP.
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/diag-treasury.ts
import { createClient } from "@supabase/supabase-js";

const KEY = "loop";

(async () => {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: proj } = await sb.from("projects").select("*").eq("key", KEY).maybeSingle();
  const treasuryWallet = proj?.treasury_wallet as string | undefined;
  const mint = proj?.mint as string | undefined;
  const price = (proj?.price as number) ?? 0;
  const network = (proj?.network as string) ?? "mainnet";
  console.log("\n=== PROJECT ===");
  console.log({ treasuryWallet, mint, price, treasury_sol: proj?.treasury_sol, network });

  console.log("\n=== fee_ledger ===");
  const { data: fl } = await sb.from("fee_ledger").select("*").eq("project_key", KEY).maybeSingle();
  console.log(fl ?? "(no fee_ledger row)");

  console.log("\n=== agent_actions: totals by kind+disposition ===");
  const { data: acts } = await sb
    .from("agent_actions")
    .select("kind,disposition,amount_sol,tx_sig,created_at,body")
    .eq("project_key", KEY)
    .order("created_at", { ascending: false });
  const agg: Record<string, { n: number; sol: number }> = {};
  let executedBuybackSol = 0;
  const txs: string[] = [];
  for (const a of acts ?? []) {
    const k = `${a.kind}/${a.disposition}`;
    agg[k] ??= { n: 0, sol: 0 };
    agg[k].n++;
    agg[k].sol += a.amount_sol ?? 0;
    if (a.kind === "buyback" && a.disposition === "executed") {
      executedBuybackSol += a.amount_sol ?? 0;
      if (a.tx_sig) txs.push(a.tx_sig);
    }
  }
  console.log(agg);
  console.log(`buyback EXECUTED total: ${executedBuybackSol} SOL across ${txs.length} tx`);
  if (txs.length) console.log("buyback tx sigs:", txs.slice(0, 10));
  console.log(`total agent_actions rows: ${acts?.length ?? 0}`);

  console.log("\n=== on-chain balances ===");
  try {
    const { getSolBalance, getSplBalance } = await import("../lib/solana");
    const net = network === "mainnet" ? "mainnet" : "devnet";
    if (treasuryWallet) {
      const sol = await getSolBalance(treasuryWallet, net as any);
      const tok = mint ? await getSplBalance(treasuryWallet, mint, net as any) : null;
      console.log("treasury wallet:", treasuryWallet, "| SOL:", sol, "| token:", tok);
    }
    const { getAgentWallet } = await import("../lib/agent-wallet");
    const aw = await getAgentWallet(KEY).catch((e) => { console.log("agent wallet lookup err:", e.message); return null; });
    if (aw) {
      const sol = await getSolBalance(aw.address, net as any);
      const tok = mint ? await getSplBalance(aw.address, mint, net as any) : null;
      console.log("AGENT wallet:", aw.address, "| SOL:", sol, "| token:", tok);
    } else {
      console.log("AGENT wallet: not provisioned / not found via Privy");
    }
  } catch (e: any) {
    console.log("on-chain read error:", e.message);
  }
})();
