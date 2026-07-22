// LAUNCH AN EXISTING PROJECT ON HOOD — records a Robinhood Chain DEPLOYMENT for
// a project that already exists (typically `loop`), rather than creating a
// second project row. One project = one slug = one agent = one backlog; Hood is
// a second FUNDING SOURCE, not a second project. (The previous version of this
// script inserted a `loop-hood` row, which meant two agents ticking on the same
// repo and duplicating Claude spend.)
//
// The token itself is launched by the FOUNDER on Pons — Robinhood Chain's
// launchpad, the Hood-side counterpart of pump.fun: a form plus an EVM wallet
// signature, no contract of ours to deploy, fund or audit. This script never
// signs an EVM transaction; it only persists the result.
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/launch-on-hood.ts <token 0x…> <treasury 0x…> [projectKey]
//
// After it runs, /token?p=<key> serves BOTH chains under the same slug: the
// header switch (and ?chain=hood) swaps the market side only.
import { supabaseAdmin } from "../lib/supabase";

const EVM_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

(async () => {
  const [token, treasury, keyArg] = process.argv.slice(2);
  const projectKey = keyArg || "loop";
  if (!token || !EVM_ADDR_RE.test(token)) {
    throw new Error("usage: launch-on-hood.ts <token 0x…> <treasury 0x…> [projectKey] — token missing/invalid.");
  }
  if (!treasury || !EVM_ADDR_RE.test(treasury)) {
    throw new Error("usage: launch-on-hood.ts <token 0x…> <treasury 0x…> [projectKey] — treasury missing/invalid.");
  }
  if (token.toLowerCase() === treasury.toLowerCase()) {
    throw new Error("token and treasury are the same address — one of them is wrong.");
  }
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set.");

  const { data: project, error: projErr } = await supabaseAdmin
    .from("projects")
    .select("key, name, ticker, chain")
    .eq("key", projectKey)
    .maybeSingle();
  if (projErr) throw new Error(`could not read project "${projectKey}": ${projErr.message}`);
  if (!project) throw new Error(`no project "${projectKey}" — launch it on its home chain first.`);

  // Never silently overwrite a live deployment: a wrong token address here would
  // point the buy panel at someone else's contract.
  const { data: existing } = await supabaseAdmin
    .from("project_chains")
    .select("mint, treasury_wallet")
    .eq("project_key", projectKey)
    .eq("chain", "hood")
    .maybeSingle();
  if (existing?.mint) {
    throw new Error(
      `"${projectKey}" already has a Hood deployment (${existing.mint}) — this script only inserts, it never overwrites a live market.`
    );
  }

  const row = {
    project_key: projectKey,
    chain: "hood",
    mint: token,
    treasury_wallet: treasury,
    launchpad: "Pons",
    network: "mainnet",
    launched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  console.log(`Recording the Hood deployment of "${projectKey}" — ${project.name} (${project.ticker})`);
  console.log(`  token:     ${token}`);
  console.log(`  treasury:  ${treasury}`);
  console.log(`  launchpad: Pons (Robinhood Chain, id 4663)`);

  const { error } = await supabaseAdmin
    .from("project_chains")
    .upsert(row, { onConflict: "project_key,chain" });
  if (error) throw new Error(`insert failed: ${error.message}`);

  console.log(`\n✅ "${projectKey}" is now live on both chains under ONE slug.`);
  console.log(`   /token?p=${projectKey}            → ${project.chain ?? "solana"} market`);
  console.log(`   /token?p=${projectKey}&chain=hood → Hood market (same agent, same backlog)`);
  console.log("   Funding either treasury extends the same agent's runway.");
})().catch((e) => {
  console.error("ABORTED:", e.message);
  process.exit(1);
});
