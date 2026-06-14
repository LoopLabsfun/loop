// End-to-end live devnet launch test. Signs a launch proof with the funded,
// LOOP-holding devnet keypair, runs the real server action (mint on devnet +
// persist via service-role), verifies the row, then deletes the test project.
//
// Run (the react-server condition resolves `server-only` to its no-op module;
// without it the import throws "cannot be imported from a Client Component"):
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/e2e-launch.ts
import fs from "fs";
import path from "path";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import { launchProjectAction } from "../lib/actions";
import { buildLaunchMessage } from "../lib/launch-message";
import { supabaseAdmin } from "../lib/supabase";

(async () => {
  const secret = JSON.parse(
    fs.readFileSync(path.join(__dirname, ".devnet-keypair.json"), "utf8")
  );
  const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
  const pubkey = kp.publicKey.toBase58();

  const ticker = "E2E" + Math.floor(Math.random() * 900 + 100);
  const ts = Date.now();
  const message = buildLaunchMessage(ticker, ts);
  const signature = Buffer.from(
    nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)
  ).toString("base64");

  console.log("creator/staker:", pubkey);
  console.log("launching $" + ticker, "on devnet…");

  const result = await launchProjectAction({
    name: "E2E Test " + ticker,
    ticker,
    prompt: "end-to-end launch verification",
    network: "devnet",
    proof: { pubkey, signature, message },
  });

  console.log("RESULT:", JSON.stringify(result, null, 2));

  // Verify persisted row carries the real mint.
  const { data } = await supabaseAdmin!
    .from("projects")
    .select("key, mint, treasury_wallet, creator_wallet, network, launchpad")
    .eq("key", result.key)
    .maybeSingle();
  console.log("ROW:", JSON.stringify(data, null, 2));

  const ok = data?.mint && data.creator_wallet === pubkey && data.network === "devnet";
  console.log(ok ? "✅ END-TO-END LAUNCH OK" : "❌ row missing mint/creator");
  if (data?.mint) {
    console.log(
      `mint explorer: https://explorer.solana.com/address/${data.mint}?cluster=devnet`
    );
  }

  // Clean up the test row.
  await supabaseAdmin!.from("projects").delete().eq("key", result.key);
  console.log("cleaned up test row:", result.key);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
