// Ingest pre-ground vanity keypairs into the scalable DB pool (vanity_keypairs).
//
// Decoupled from grinding: point it at any directory of solana-keygen keypair
// files (CPU `solana-keygen grind --ends-with Loop:N`, or a GPU grinder dumping
// the same JSON-array format). Inserts each into the table via the service-role
// client; the launch path then claims them atomically (claim_vanity_keypair).
//
// Run (sources secrets from .env.local):
//   set -a; source .env.local; set +a
//   node scripts/ingest-vanity-pool.cjs [dir=scripts/.vanity-pool] [suffix=Loop]
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { Keypair, Connection, clusterApiUrl } = require("@solana/web3.js");

const dir = process.argv[2] || path.join(__dirname, ".vanity-pool");
const suffix = process.argv[3] || "Loop";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

(async () => {
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
    : [];
  if (files.length === 0) {
    console.error(`No keypair files in ${dir}. Grind some first.`);
    process.exit(1);
  }

  // Skip any address already used on-chain (a spent mint can't be reused).
  const conn = new Connection(
    process.env.DEVNET_RPC || clusterApiUrl("devnet"),
    "confirmed"
  );

  let inserted = 0,
    skipped = 0;
  for (const f of files) {
    const secret = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (!Array.isArray(secret) || secret.length !== 64) {
      skipped++;
      continue;
    }
    const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
    const pubkey = kp.publicKey.toBase58();
    if (!pubkey.endsWith(suffix)) {
      console.error(`  skip ${pubkey} (not …${suffix})`);
      skipped++;
      continue;
    }
    if ((await conn.getAccountInfo(kp.publicKey)) !== null) {
      console.error(`  skip ${pubkey} (already used on-chain)`);
      skipped++;
      continue;
    }
    const { error } = await db
      .from("vanity_keypairs")
      .upsert({ pubkey, secret_key: secret, suffix, used: false }, { onConflict: "pubkey", ignoreDuplicates: true });
    if (error) {
      console.error(`  error ${pubkey}: ${error.message}`);
      skipped++;
    } else {
      console.log(`  + ${pubkey}`);
      inserted++;
    }
  }

  const { count } = await db
    .from("vanity_keypairs")
    .select("*", { count: "exact", head: true })
    .eq("suffix", suffix)
    .eq("used", false);
  console.log(`\ningested ${inserted}, skipped ${skipped}. Unused "${suffix}" in pool: ${count}`);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
