// Assemble a VANITY_POOL env value from pre-ground keypair files.
//
// 1. Grind a pool (each ~40s of CPU for a 4-char suffix like "Loop"):
//      cd scripts/.vanity-pool && solana-keygen grind --ends-with Loop:10 --no-bip39-passphrase
// 2. Build the env value:
//      node scripts/build-vanity-pool.cjs
// 3. Set it (and the suffix) in your environment / Vercel:
//      VANITY_POOL='[[...],[...]]'   MINT_VANITY_SUFFIX=Loop
//
// The pool dir is gitignored — these are secret keys (inert once used as a mint,
// but keep them out of git all the same).
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, ".vanity-pool");
const suffix = process.argv[2] || "Loop";

const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
  : [];

const pool = [];
for (const f of files) {
  const secret = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  if (Array.isArray(secret) && secret.length === 64) pool.push(secret);
}

const pubkeys = files.map((f) => f.replace(/\.json$/, ""));
console.error(`Pool: ${pool.length} keypair(s), suffix "${suffix}":`);
for (const pk of pubkeys) {
  console.error(`  ${pk}${pk.endsWith(suffix) ? "" : "  (does NOT end in " + suffix + ")"}`);
}
console.error("\nVANITY_POOL value (set this in your env / Vercel):\n");
process.stdout.write(JSON.stringify(pool));
process.stdout.write("\n");
