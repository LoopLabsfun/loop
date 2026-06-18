// POST THE LOOP MARKETING CAMPAIGN to @looplabsfun via the X API.
//
// Run:
//   set -a; source .env.local; set +a
//   # preview only (no posting):
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-tweets.ts --dry-run
//   # post all, 1h apart (inbound cadence):
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-tweets.ts --delay 3600
//   # post just one (1-based):
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-tweets.ts --only 1
//
// Needs the 4 X_* keys in .env.local (run scripts/x-auth.ts once to get the
// access token/secret for @looplabsfun). --dry-run needs no keys.
import { isXConfigured, sendTweet } from "../lib/x-send";
import {
  TWEETS,
  TWEET_MAX,
  weightedTweetLength,
} from "./marketing-tweets";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const dryRun = process.argv.includes("--dry-run");
const delaySec = Number(arg("--delay") ?? "0");
const onlyOne = arg("--only") ? Number(arg("--only")) : undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Pick the tweets to post (all, or just one 1-based index).
  const chosen =
    onlyOne != null
      ? TWEETS.slice(onlyOne - 1, onlyOne)
      : TWEETS;
  if (!chosen.length) {
    console.error(`Nothing to post (──only ${onlyOne} out of range 1..${TWEETS.length}).`);
    process.exit(1);
  }

  // Validate every tweet up-front so we never half-post a campaign.
  const over = chosen
    .map((t, i) => ({ i, len: weightedTweetLength(t) }))
    .filter((x) => x.len > TWEET_MAX);
  if (over.length) {
    for (const o of over) {
      console.error(`✗ tweet #${o.i + 1} is ${o.len} chars (>${TWEET_MAX}). Trim it.`);
    }
    process.exit(1);
  }

  if (dryRun) {
    console.log(`DRY RUN — ${chosen.length} tweet(s), nothing posted.\n`);
    chosen.forEach((t, i) => {
      console.log(`── #${i + 1}  (${weightedTweetLength(t)}/${TWEET_MAX} chars) ──`);
      console.log(t + "\n");
    });
    return;
  }

  if (!isXConfigured()) {
    console.error(
      "❌ X not configured — set X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET in .env.local (run scripts/x-auth.ts first). Or use --dry-run."
    );
    process.exit(1);
  }

  console.log(
    `Posting ${chosen.length} tweet(s) to @looplabsfun${delaySec ? `, ${delaySec}s apart` : ""}…\n`
  );
  for (let i = 0; i < chosen.length; i++) {
    const r = await sendTweet(chosen[i]);
    if (r.ok) {
      console.log(`✅ #${i + 1} posted → https://x.com/looplabsfun/status/${r.id}`);
    } else if (r.skipped) {
      console.log(`⏭️  #${i + 1} skipped (X not configured).`);
    } else {
      console.error(`❌ #${i + 1} failed: ${r.error}`);
    }
    if (delaySec && i < chosen.length - 1) await sleep(delaySec * 1000);
  }
  console.log("\nDone.");
})().catch((e) => {
  console.error("\npost-tweets failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
