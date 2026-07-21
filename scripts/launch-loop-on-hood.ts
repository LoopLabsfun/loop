// LOOP-ON-HOOD RELAUNCH — inserts the official chain='hood' project row once
// the Hood launcher is deployed AND createToken(LOOP) has been run on-chain
// (both are the FOUNDER's own actions via `cast`/`forge`, per docs/multichain-hood.md
// Phase 4 — this script never signs an EVM transaction, it only persists the
// result). The existing Solana `loop` row is untouched and stays live; this
// inserts a SEPARATE row (key `loop-hood`) so the two chains' agent loops,
// treasuries, and task histories stay independent (see lib/repo-lock.ts for
// why that's now safe to do concurrently against the same GitHub repo).
//
// Run once you have the launcher address + the new token's ERC-20 address:
//   set -a; source .env.local; set +a
//   npx tsx scripts/launch-loop-on-hood.ts <mint 0x…> <treasury 0x…>
import { supabaseAdmin } from "../lib/supabase";

const HOOD_KEY = "loop-hood";
const SOLANA_KEY = "loop";
const EVM_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

(async () => {
  const [mint, treasury] = process.argv.slice(2);
  if (!mint || !EVM_ADDR_RE.test(mint)) {
    throw new Error("usage: launch-loop-on-hood.ts <mint 0x…> <treasury 0x…> — mint missing/invalid.");
  }
  if (!treasury || !EVM_ADDR_RE.test(treasury)) {
    throw new Error("usage: launch-loop-on-hood.ts <mint 0x…> <treasury 0x…> — treasury missing/invalid.");
  }
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set.");

  const { data: existing } = await supabaseAdmin
    .from("projects")
    .select("key")
    .eq("key", HOOD_KEY)
    .maybeSingle();
  if (existing) {
    throw new Error(`"${HOOD_KEY}" already exists — this script only inserts, it never overwrites a live row.`);
  }

  // Carry the SAME brand identity as the Solana row (name/ticker/description/
  // socials/cover/prompt/repo) — this is meant to read as "the same project,
  // a second market," not a fresh launch. `repo` staying identical is exactly
  // what lib/repo-lock.ts's cross-project lock protects.
  const { data: sol, error: solErr } = await supabaseAdmin
    .from("projects")
    .select(
      "name,ticker,description,cover,prompt,repo,twitter,telegram,discord,website,token_image_url,banner_url,fee_founder_pct,content_policy,guardrails"
    )
    .eq("key", SOLANA_KEY)
    .single();
  if (solErr || !sol) {
    throw new Error(`could not read the Solana "${SOLANA_KEY}" row to copy brand fields from: ${solErr?.message}`);
  }

  const row = {
    key: HOOD_KEY,
    name: sol.name,
    ticker: sol.ticker,
    description: sol.description,
    official: true,
    launchpad: "Hood Launcher",
    repo: sol.repo,
    cover: sol.cover,
    prompt: sol.prompt,
    chain: "hood",
    mint,
    treasury_wallet: treasury,
    twitter: sol.twitter,
    telegram: sol.telegram,
    discord: sol.discord,
    website: sol.website,
    token_image_url: sol.token_image_url,
    banner_url: sol.banner_url,
    fee_founder_pct: sol.fee_founder_pct,
    content_policy: sol.content_policy,
    guardrails: sol.guardrails,
  };

  console.log(`Inserting "${HOOD_KEY}" — ${sol.name} (${sol.ticker}) on Robinhood Chain (4663)`);
  console.log(`mint: ${mint}`);
  console.log(`treasury: ${treasury}`);

  const { error } = await supabaseAdmin.from("projects").insert(row);
  if (error) throw new Error(`insert failed: ${error.message}`);

  console.log(`\n✅ "${HOOD_KEY}" is live. Set NEXT_PUBLIC_HOOD_LOOP_MINT=${mint} in Vercel to light up`);
  console.log("   the treasury/trading panels (per docs/multichain-hood.md), then redeploy.");
  console.log(`   Solana "${SOLANA_KEY}" is untouched and stays live — the two now cross-link on /token.`);
})().catch((e) => {
  console.error("ABORTED:", e.message);
  process.exit(1);
});
