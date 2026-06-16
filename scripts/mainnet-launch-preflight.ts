// MAINNET LAUNCH PREFLIGHT — read-only readiness check for the pump.fun "…Loop"
// launch. Spends nothing, submits nothing, claims no vanity key. Verifies the
// pieces only the founder can supply (a funded mainnet creator wallet) are in
// place before the real, irreversible launch.
//
// Run:
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/mainnet-launch-preflight.ts
import { Keypair } from "@solana/web3.js";
import { parseSecretKeyJson } from "../lib/vanity";
import { supabaseAdmin } from "../lib/supabase";

// pump.fun create ≈ rent + priority fee, no dev-buy (amount: 0 in buildCreatePayload).
const MIN_SOL_NEEDED = 0.03;

async function mainnetBalanceSol(pubkey: string): Promise<number | null> {
  const key = process.env.HELIUS_API_KEY;
  const url = key
    ? `https://mainnet.helius-rpc.com/?api-key=${key}`
    : "https://api.mainnet-beta.solana.com";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [pubkey] }),
    });
    const json = await res.json();
    const lamports = json?.result?.value;
    return typeof lamports === "number" ? lamports / 1e9 : null;
  } catch {
    return null;
  }
}

(async () => {
  const checks: { label: string; ok: boolean; detail: string }[] = [];
  const add = (label: string, ok: boolean, detail: string) =>
    checks.push({ label, ok, detail });

  // 1) creator signer present + its mainnet balance
  const secret = process.env.LAUNCH_SIGNER_SECRET;
  let signerAddr = "(unset)";
  let bal: number | null = null;
  if (secret) {
    const bytes = parseSecretKeyJson(secret);
    if (bytes) {
      signerAddr = Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey.toBase58();
      bal = await mainnetBalanceSol(signerAddr);
    }
  }
  add("LAUNCH_SIGNER_SECRET set", Boolean(secret), signerAddr);
  add(
    `creator funded ≥ ${MIN_SOL_NEEDED} SOL (mainnet)`,
    bal != null && bal >= MIN_SOL_NEEDED,
    bal == null ? "could not read balance" : `${bal} SOL`
  );

  // 2) vanity pool has an unused "…Loop" key (read-only count; not claimed)
  const suffix = process.env.MINT_VANITY_SUFFIX || "(unset)";
  let unused = 0;
  if (supabaseAdmin) {
    const { count } = await supabaseAdmin
      .from("vanity_keypairs")
      .select("*", { count: "exact", head: true })
      .eq("suffix", suffix)
      .eq("used", false);
    unused = count ?? 0;
  }
  add(`MINT_VANITY_SUFFIX = "${suffix}"`, suffix === "Loop", suffix);
  add(`unused "…${suffix}" vanity keys`, unused > 0, `${unused} available`);

  // 3) config that the launch needs (these flip the platform to mainnet pump.fun)
  add("HELIUS_API_KEY set (mainnet RPC)", Boolean(process.env.HELIUS_API_KEY), "");
  add(
    "SUPABASE_SERVICE_ROLE_KEY set (persist mint)",
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ""
  );

  console.log("\n── MAINNET LAUNCH PREFLIGHT ──\n");
  for (const c of checks) {
    console.log(`${c.ok ? "✅" : "❌"} ${c.label}${c.detail ? `  — ${c.detail}` : ""}`);
  }
  const ready = checks.every((c) => c.ok);
  console.log(
    `\n${ready ? "🟢 READY — all preflight checks pass." : "🔴 NOT READY — fix the ❌ above."}`
  );
  if (!ready && signerAddr !== "(unset)" && (bal == null || bal < MIN_SOL_NEEDED)) {
    console.log(
      `\n→ Fund the creator wallet with real SOL on mainnet:\n   ${signerAddr}\n   (~${MIN_SOL_NEEDED} SOL covers create + fees; no dev-buy.)`
    );
  }
  console.log(
    "\nNothing was spent or submitted. The real launch is a separate explicit step."
  );
})().catch((e) => {
  console.error("preflight failed:", e.message);
  process.exit(1);
});
