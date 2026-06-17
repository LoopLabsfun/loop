// X SEND SMOKE TEST — posts a tweet via the real send path, confirms which
// account it landed on, then DELETES it (so nothing lingers on the public
// @looplabsfun timeline). Proves the full OAuth 1.0a pipe end-to-end.
//
// Run:
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/x-test.ts
import { isXConfigured, oauth1Header, sendTweet, type OAuth1Creds } from "../lib/x-send";

(async () => {
  if (!isXConfigured()) {
    console.error("❌ X not configured — set all 4 X_* keys in .env.local.");
    process.exit(1);
  }
  const creds: OAuth1Creds = {
    consumerKey: process.env.X_API_KEY!,
    consumerSecret: process.env.X_API_SECRET!,
    token: process.env.X_ACCESS_TOKEN!,
    tokenSecret: process.env.X_ACCESS_SECRET!,
  };

  // 1) who do these tokens actually post as? (verify_credentials, read-only)
  const vcUrl = "https://api.twitter.com/1.1/account/verify_credentials.json";
  const vc = await fetch(vcUrl, { headers: { Authorization: oauth1Header("GET", vcUrl, creds) } });
  const who = (await vc.json().catch(() => null)) as { screen_name?: string } | null;
  console.log(`token authorizes: @${who?.screen_name ?? "(unknown)"}`);

  // 2) post a uniquely-marked test tweet
  const text = `loop.fun send-path check ${new Date().toISOString()} — auto-deleting.`;
  const posted = await sendTweet(text);
  if (!posted.ok || !posted.id) {
    console.error("❌ post failed:", posted.error ?? "(no id)");
    process.exit(1);
  }
  console.log(`✅ posted id=${posted.id}  https://x.com/${who?.screen_name}/status/${posted.id}`);

  // 3) delete it (same user-context creds; DELETE /2/tweets/:id)
  const delUrl = `https://api.twitter.com/2/tweets/${posted.id}`;
  const del = await fetch(delUrl, {
    method: "DELETE",
    headers: { Authorization: oauth1Header("DELETE", delUrl, creds) },
  });
  const delJson = (await del.json().catch(() => null)) as { data?: { deleted?: boolean } } | null;
  console.log(
    delJson?.data?.deleted
      ? "✅ deleted — nothing left on the timeline. Full pipe works."
      : `⚠️  could not auto-delete (HTTP ${del.status}); remove it manually: id=${posted.id}`
  );
})().catch((e) => {
  console.error("x-test failed:", e.message);
  process.exit(1);
});
