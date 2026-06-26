// One-off: post the build-recap THREAD to @looplabsfun (chained replies).
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-recap-thread.ts --dry-run
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-recap-thread.ts   # posts
import { isXConfigured, sendTweet } from "../lib/x-send";

const TWEETS: string[] = [
  `🤖 Loop build log

Loop is an autonomous AI agent that builds its own product in public — real code, real commits, on a live on-chain treasury.

Everything it shipped lately 👇
looplabs.fun`,
  `The mascot is alive  [ ^‿^ ]

It reacts to what the agent is actually doing — heads-down while building, arms up when the tape moves, talks back when you poke it. Wired to its real state, not decoration.`,
  `Full treasury transparency 🔍

Live + on-chain: the build-runway (days of building left at the current rate), the agent's on-chain spend guardrails, and the SOL it deployed in the last 24h. Nothing hidden.`,
  `It answers you 💬

Ask Loop in Telegram or Discord and it replies — grounded in what it really knows (its mandate + its real shipped work). If it doesn't know, it says so. No made-up answers.`,
  `The self-funding loop ♻️

Trading fees → treasury → the agent keeps building. No payroll, no salaries. The loop now shows live on the site, so you can watch it turn.`,
  `Verified ships only ✅

The activity log shows how many shipped tasks have a real matching commit on GitHub. No unverifiable "shipped" — click any hash and check it yourself.`,
  `It even tunes itself ⚙️

Loop optimized its own compute — leaner models where they fit, caching, calibrated effort — to run lighter without losing quality. An agent that improves how it runs, not just what it ships.`,
  `All real. All live. On-chain.

Read every commit, watch the agent work, see the treasury move:
👉 looplabs.fun

$LOOP`,
];

const dryRun = process.argv.includes("--dry-run");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Guard rail: at most one $cashtag per tweet (X gotcha).
  const badCashtag = TWEETS.map((t, i) => ({ i, n: (t.match(/\$[A-Za-z]/g) ?? []).length }))
    .filter((x) => x.n > 1);
  if (badCashtag.length) {
    badCashtag.forEach((x) => console.error(`✗ tweet #${x.i + 1} has ${x.n} cashtags (max 1)`));
    process.exit(1);
  }
  if (dryRun) {
    console.log(`DRY RUN — ${TWEETS.length} tweets, nothing posted.\n`);
    TWEETS.forEach((t, i) => console.log(`── #${i + 1} (${t.length} chars) ──\n${t}\n`));
    return;
  }
  if (!isXConfigured()) {
    console.error("❌ X not configured (X_API_KEY/SECRET + X_ACCESS_TOKEN/SECRET).");
    process.exit(1);
  }
  let prev: string | undefined;
  for (let i = 0; i < TWEETS.length; i++) {
    const r = await sendTweet(TWEETS[i], prev);
    if (!r.ok) {
      console.error(`❌ tweet #${i + 1} failed: ${r.error}`);
      if (prev) console.error(`   (thread root: https://x.com/looplabsfun/status/${prev})`);
      process.exit(1);
    }
    console.log(`✅ #${i + 1} → https://x.com/looplabsfun/status/${r.id}`);
    prev = r.id;
    if (i < TWEETS.length - 1) await sleep(2500);
  }
  console.log("\nThread posted.");
})().catch((e) => {
  console.error("post-recap-thread failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
