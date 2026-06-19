// Run ONE real buyback for the LOOP project through the production exec path
// (lib/agent-actions-exec.executeBuyback → Jupiter quote → Privy sign+send),
// then record the honest agent_actions row exactly like the runtime does. This
// is the same code the autonomous tick runs — not a mock — so a successful run
// is proof the buyback path is live, and flips the Project Wallet widget from
// "simulated" to a real "executed" position with an on-chain tx.
//
//   set -a; source .env.local; set +a
//   # plan only (read-only — fetches a real quote, signs NOTHING):
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/run-buyback.ts --amount 0.05
//   # execute for real (signs + broadcasts a mainnet swap — moves SOL):
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/run-buyback.ts --amount 0.05 --execute
//
// Needs Node ≥ 20 (global fetch/Headers). Run with nvm use 23.
import { createClient } from "@supabase/supabase-js";

const KEY = "loop";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const RESERVE_SOL = 0.02; // keep gas + ATA rent in the agent wallet

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const EXECUTE = process.argv.includes("--execute");
const AMOUNT = Number(arg("amount", "0.05"));

(async () => {
  if (!Number.isFinite(AMOUNT) || AMOUNT <= 0) {
    throw new Error(`--amount must be a positive number of SOL (got ${AMOUNT}).`);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data: proj } = await sb.from("projects").select("*").eq("key", KEY).maybeSingle();
  const mint = proj?.mint as string | undefined;
  const network = ((proj?.network as string) ?? "mainnet") === "mainnet" ? "mainnet" : "devnet";
  if (!mint) throw new Error("LOOP project has no mint — nothing to buy back.");
  console.log(`\n=== BUYBACK PLAN (${EXECUTE ? "EXECUTE" : "dry-run"}) ===`);
  console.log({ key: KEY, mint, network, amountSol: AMOUNT });

  // Resolve the Privy agent wallet (the hot operating wallet buybacks sign from).
  const { getAgentWallet } = await import("../lib/agent-wallet");
  const agentWallet = await getAgentWallet(KEY).catch((e) => {
    console.log("agent wallet lookup err:", e.message);
    return null;
  });
  if (!agentWallet) throw new Error("Agent wallet not provisioned via Privy.");

  const { getSolBalance, getMintDecimals } = await import("../lib/solana");
  const bal = (await getSolBalance(agentWallet.address, network as "mainnet" | "devnet")) ?? 0;
  console.log("agent wallet:", agentWallet.address, "| SOL:", bal);
  if (AMOUNT > bal - RESERVE_SOL) {
    throw new Error(
      `Amount ${AMOUNT} SOL leaves < ${RESERVE_SOL} SOL reserve (balance ${bal}). Lower --amount.`
    );
  }

  // Show the live route either way (this is what the agent would commit to).
  const q = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: mint,
    amount: String(Math.round(AMOUNT * 1e9)),
    slippageBps: "150",
    swapMode: "ExactIn",
  });
  const base = process.env.JUP_API_BASE || "https://lite-api.jup.ag/swap/v1";
  const quote = (await (await fetch(`${base}/quote?${q}`)).json()) as {
    outAmount?: string;
    swapUsdValue?: string;
    error?: string;
    routePlan?: { swapInfo?: { label?: string } }[];
  };
  if (quote.error) throw new Error(`Jupiter quote: ${quote.error}`);
  console.log("quote:", {
    outAmount: quote.outAmount,
    usd: quote.swapUsdValue,
    via: quote.routePlan?.map((r) => r.swapInfo?.label).join(" → "),
  });

  if (!EXECUTE) {
    console.log("\n(dry-run) nothing signed. Re-run with --execute to broadcast.\n");
    return;
  }

  // Real execution through the production exec path.
  const { executeBuyback } = await import("../lib/agent-actions-exec");
  const r = await executeBuyback(
    { kind: "buyback", amountSol: AMOUNT, note: "manual founder-confirmed buyback" },
    { outputMint: mint, cluster: network as "mainnet" | "devnet", agentWallet }
  );
  console.log("\n=== RESULT ===");
  console.log(r);

  const disposition = r.executed ? "executed" : r.escalated ? "escalated" : "simulated";
  // Name the token bought + how much came back, so the note says WHAT was bought.
  const ticker = (proj?.ticker as string) || "tokens";
  const dec = (await getMintDecimals(mint, network as "mainnet" | "devnet")) ?? 0;
  const outRaw = r.expectedOut ?? quote.outAmount;
  const tokenOut =
    outRaw && dec
      ? ` ${r.executed ? "→" : "≈"} ${Math.round(Number(outRaw) / 10 ** dec).toLocaleString("en-US")} ${ticker}`
      : "";
  const head = r.executed
    ? "🟢 buyback executed"
    : r.simulated
      ? "🟡 buyback simulated"
      : "⚠️ buyback held";
  const note = `${head} ${AMOUNT} SOL${tokenOut}${r.executed ? "" : ` — ${r.reason}`}`.slice(0, 280);

  // Clear stale no-op artifacts (simulated 0-SOL rows from the dead-Jupiter era)
  // so the widget isn't polluted by misleading "0 SOL — fetch failed" notes.
  const del = await sb
    .from("agent_actions")
    .delete()
    .eq("project_key", KEY)
    .eq("kind", "buyback")
    .eq("disposition", "simulated")
    .eq("amount_sol", 0);
  if (del.error) console.log("stale-row cleanup err:", del.error.message);

  const { error } = await sb.from("agent_actions").insert({
    project_key: KEY,
    kind: "buyback",
    amount_sol: AMOUNT,
    disposition,
    tx_sig: r.txSig ?? null,
    body: note,
  });
  if (error) throw new Error(`row insert failed: ${error.message}`);
  console.log("\nrecorded agent_actions row:", { disposition, tx_sig: r.txSig, note });
  if (r.txSig) console.log(`explorer: https://solscan.io/tx/${r.txSig}`);
})().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
