// X (TWITTER) AUTH — one-time PIN flow (OAuth 1.0a, 3-legged "oob") that turns
// the Go Disrupt app's consumer key/secret into ACCESS tokens that authorize a
// specific account. Sign in as @looplabsfun on the authorize step → the tokens
// post AS @looplabsfun even though the app belongs to Go Disrupt.
//
// Prereq: put the app's keys in .env.local first:
//   X_API_KEY=...        (consumer key,  from the Go Disrupt app)
//   X_API_SECRET=...     (consumer secret)
//
// Run:
//   set -a; source .env.local; set +a
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/x-auth.ts
//
// It prints X_ACCESS_TOKEN / X_ACCESS_SECRET to paste into .env.local (and Vercel).
// These do not expire — you run this once per account.
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { oauth1Header, type OAuth1Creds } from "../lib/x-send";

const REQUEST_TOKEN_URL = "https://api.twitter.com/oauth/request_token";
const AUTHORIZE_URL = "https://api.twitter.com/oauth/authorize";
const ACCESS_TOKEN_URL = "https://api.twitter.com/oauth/access_token";

/**
 * POST a signed OAuth-endpoint request. `params` are transmitted in the query
 * string AND signed (the base string is the URL without query + these params),
 * which is how oauth1Header's `extra` is meant to be used. Returns the parsed
 * form-encoded body.
 */
async function signedPost(
  url: string,
  creds: OAuth1Creds,
  params: Record<string, string>
): Promise<URLSearchParams> {
  const Authorization = oauth1Header("POST", url, creds, params);
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(qs ? `${url}?${qs}` : url, {
    method: "POST",
    headers: { Authorization },
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}\n${body}`);
  }
  return new URLSearchParams(body);
}

(async () => {
  const consumerKey = process.env.X_API_KEY;
  const consumerSecret = process.env.X_API_SECRET;
  if (!consumerKey || !consumerSecret) {
    throw new Error(
      "Set X_API_KEY and X_API_SECRET (the Go Disrupt app's consumer key/secret) in .env.local first."
    );
  }

  // ── 1) Request token (oauth_callback=oob → PIN flow) ──
  const reqCreds: OAuth1Creds = { consumerKey, consumerSecret, token: "", tokenSecret: "" };
  const step1 = await signedPost(REQUEST_TOKEN_URL, reqCreds, { oauth_callback: "oob" });
  const requestToken = step1.get("oauth_token");
  const requestTokenSecret = step1.get("oauth_token_secret");
  if (!requestToken || !requestTokenSecret) {
    throw new Error(`request_token returned no token: ${step1.toString()}`);
  }
  if (step1.get("oauth_callback_confirmed") !== "true") {
    console.warn("⚠️  oauth_callback_confirmed != true — continuing anyway.");
  }

  // ── 2) Authorize (human step): open as @looplabsfun, approve, copy the PIN ──
  console.log("\n────────────────────────────────────────────────────────");
  console.log("1. Open this URL in a browser where you're signed in as");
  console.log("   @looplabsfun (NOT go_disrupt) and click Authorize:\n");
  console.log(`   ${AUTHORIZE_URL}?oauth_token=${requestToken}\n`);
  console.log("2. X shows a 7-digit PIN. Paste it below.");
  console.log("────────────────────────────────────────────────────────\n");

  const rl = readline.createInterface({ input, output });
  const pin = (await rl.question("PIN: ")).trim();
  rl.close();
  if (!/^\d{4,10}$/.test(pin)) {
    throw new Error(`"${pin}" doesn't look like a PIN.`);
  }

  // ── 3) Exchange the PIN for the account's long-lived access tokens ──
  const accessCreds: OAuth1Creds = {
    consumerKey,
    consumerSecret,
    token: requestToken,
    tokenSecret: requestTokenSecret,
  };
  const step3 = await signedPost(ACCESS_TOKEN_URL, accessCreds, { oauth_verifier: pin });
  const accessToken = step3.get("oauth_token");
  const accessSecret = step3.get("oauth_token_secret");
  const screenName = step3.get("screen_name");
  if (!accessToken || !accessSecret) {
    throw new Error(`access_token returned no token: ${step3.toString()}`);
  }

  console.log(`\n✅ Authorized as @${screenName} (user id ${step3.get("user_id")})`);
  if (screenName && screenName.toLowerCase() !== "looplabsfun") {
    console.log(
      `⚠️  Heads up: you authorized @${screenName}, not @looplabsfun. Re-run signed in as @looplabsfun if that's wrong.`
    );
  }
  console.log("\nAdd these to .env.local (and Vercel → Production):\n");
  console.log(`X_ACCESS_TOKEN=${accessToken}`);
  console.log(`X_ACCESS_SECRET=${accessSecret}`);
  console.log("\nThese tokens don't expire. Keep them secret (server-only).");
})().catch((e) => {
  console.error("\nx-auth failed:", e.message);
  process.exit(1);
});
