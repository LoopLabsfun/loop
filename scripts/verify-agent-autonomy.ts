// Verify the LOOP agent can ACT AUTONOMOUSLY with its own wallet — a read-only
// preflight (moves NO money). Prints a PASS/FAIL checklist of every precondition
// for unattended on-chain action, so we know exactly what's green before handing
// the agent real responsibilities. Each line maps to one capability:
//   decide (brain) · find its wallet · sign unattended (custody) · funds ·
//   a tradable target · the mandate gate (auto-exec in-bounds, escalate the
//   irreversible) · and living proof it has already acted on-chain.
//
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-agent-autonomy.ts
// Needs Node ≥ 20 (nvm use 23) + service-role + Privy env.
import { createClient } from "@supabase/supabase-js";

const KEY = "loop";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const RESERVE_SOL = 0.02;

const results: boolean[] = [];
function check(ok: boolean, label: string, detail?: string) {
  results.push(ok);
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

(async () => {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: proj } = await sb
    .from("projects")
    .select("key,ticker,mint,network")
    .eq("key", KEY)
    .maybeSingle();
  const mint = proj?.mint as string | undefined;
  const net = ((proj?.network as string) ?? "mainnet") === "mainnet" ? "mainnet" : "devnet";
  console.log(`\n=== AGENT AUTONOMY PREFLIGHT · ${KEY} (${net}) ===\n`);

  // 1. Brain — can the agent decide its next move on its own?
  const { agentRuntimeConfigured, routeAction } = await import("../lib/agent-runtime");
  check(agentRuntimeConfigured(), "Brain — ANTHROPIC_API_KEY set (agent decides each tick)");

  // 2-3. Custody — Privy configured, and the agent finds its OWN wallet by key.
  const { agentWalletConfigured, getAgentWallet } = await import("../lib/agent-wallet");
  check(agentWalletConfigured(), "Custody — Privy configured (PRIVY_APP_ID / PRIVY_APP_SECRET)");
  const aw = await getAgentWallet(KEY).catch(() => null);
  check(Boolean(aw), "Wallet — agent resolves its own Privy wallet", aw?.address);

  // 4. Funds — wallet holds more than the gas/rent reserve, so it can spend.
  const { getSolBalance } = await import("../lib/solana");
  const bal = aw ? (await getSolBalance(aw.address, net)) ?? 0 : 0;
  check(bal > RESERVE_SOL, `Funds — wallet > ${RESERVE_SOL} SOL reserve`, `${bal} SOL`);

  // 5. Target — the token has a live DEX route, so a buyback can actually fill.
  let tradable = false;
  let routeNote = "no mint";
  if (mint) {
    try {
      const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${mint}&amount=10000000&slippageBps=150&swapMode=ExactIn`;
      const j = (await (await fetch(url)).json()) as {
        outAmount?: string;
        error?: string;
        routePlan?: { swapInfo?: { label?: string } }[];
      };
      tradable = Boolean(j.outAmount);
      routeNote = j.error ?? `via ${j.routePlan?.map((r) => r.swapInfo?.label).join(" → ")}`;
    } catch (e) {
      routeNote = e instanceof Error ? e.message : "quote failed";
    }
  }
  check(tradable, "Target — token is tradable (buyback has a route)", routeNote);

  // 6. Mandate gate — an in-bounds action auto-executes WITHOUT a human, while
  //    the irreversible still escalates. This is the autonomy/safety boundary.
  const inBounds = routeAction({ kind: "buyback", amountSol: 0.05 });
  check(
    inBounds.disposition === "execute",
    "Mandate — small buyback auto-approves (no founder sign-off)",
    inBounds.disposition
  );
  const irreversible = routeAction({ kind: "burn", amountTokens: 1 });
  check(
    irreversible.disposition === "escalate",
    "Safety — irreversible (burn) escalates to founder",
    irreversible.disposition
  );

  // 7. Proof — an executed on-chain action with a real signature already exists.
  const { data: acts } = await sb
    .from("agent_actions")
    .select("kind,disposition,amount_sol,tx_sig,body,created_at")
    .eq("project_key", KEY)
    .eq("disposition", "executed")
    .not("tx_sig", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const proof = (acts as { amount_sol: number; tx_sig: string }[] | null)?.[0];
  check(
    Boolean(proof),
    "Proof — an executed on-chain action exists",
    proof ? `${proof.amount_sol} SOL · ${proof.tx_sig}` : "none yet"
  );

  const pass = results.filter(Boolean).length;
  const all = results.length;
  console.log(
    `\n${pass}/${all} — ${pass === all ? "🟢 the agent can act autonomously with its wallet." : "🟡 close the ❌ items before handing it responsibilities."}\n`
  );
  process.exit(pass === all ? 0 : 1);
})().catch((e) => {
  console.error("\nPREFLIGHT ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
