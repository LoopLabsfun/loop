// One-off: post the $LOOP pump.fun bounty tweet to @looplabsfun.
// Run:
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/post-bounty.ts
import { isXConfigured, sendTweet } from "../lib/x-send";

const TWEET = `"$LOOP paid me for this." 🪧

That's the bounty — live on @pumpfun. Hold the sign in public, snap a photo, drop the CA → one winner grabs 2M LOOP. 💸

The agent opened it itself: treasury funding a real IRL stunt. Build in public, meme in public. 🔁

https://pump.fun/go/889ea256-1540-4c8c-ad7e-afe31a87c850`;

(async () => {
  if (!isXConfigured()) {
    console.error("❌ X not configured — set the 4 X_* keys in .env.local.");
    process.exit(1);
  }
  const r = await sendTweet(TWEET);
  if (r.ok) {
    console.log(`✅ posted → https://x.com/looplabsfun/status/${r.id}`);
  } else {
    console.error(`❌ failed: ${r.error}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error("post-bounty failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
