// Provision a project's agent wallet via Privy (external custody) and persist
// its address to projects.agent_wallet (service-role). Idempotent: reuses the
// existing wallet (keyed by external_id) if already provisioned.
//
// Run:
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/provision-agent-wallet.ts loop
import {
  provisionAgentWallet,
  getAgentWallet,
  agentWalletConfigured,
} from "../lib/agent-wallet";
import { supabaseAdmin } from "../lib/supabase";

(async () => {
  const key = process.argv[2] || "loop";
  if (!agentWalletConfigured()) {
    console.error("PRIVY_APP_ID / PRIVY_APP_SECRET not set.");
    process.exit(1);
  }
  if (!supabaseAdmin) {
    console.error("SUPABASE_SERVICE_ROLE_KEY not set (needed to persist).");
    process.exit(1);
  }

  const existing = await getAgentWallet(key);
  const wallet = existing ?? (await provisionAgentWallet(key));
  console.log(existing ? "reused existing wallet" : "provisioned new wallet");
  console.log("project:", key);
  console.log("agent wallet:", wallet.address);
  console.log("privy id:", wallet.id);

  const { error } = await supabaseAdmin
    .from("projects")
    .update({ agent_wallet: wallet.address })
    .eq("key", key);
  if (error) {
    console.error("persist failed:", error.message);
    process.exit(1);
  }
  console.log(`✅ stored agent_wallet for "${key}"`);
  console.log(
    `explorer: https://explorer.solana.com/address/${wallet.address}?cluster=devnet`
  );
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
