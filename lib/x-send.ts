import "server-only";

import crypto from "node:crypto";
import type { Project } from "./types";
import { buildLaunchTweet, type LaunchTweetOptions } from "./x-recap";

// ─────────────────────────────────────────────────────────────────────────────
// X (TWITTER) SEND PATH — posts a tweet via the X API v2 (POST /2/tweets) using
// OAuth 1.0a User Context. The app lives on the Go Disrupt developer account
// (the consumer key/secret), but the access token/secret authorize a specific
// USER (@looplabsfun) — so tweets appear on @looplabsfun. Get those user tokens
// once with `scripts/x-auth.ts` (PIN flow, sign in as @looplabsfun).
//
// Server-only: the 4 secrets never reach the browser. No-op (skipped) when
// unconfigured, so the app/runtime work uninterrupted until X is set up.
// OAuth 1.0a (not OAuth 2.0) on purpose: the user tokens don't expire, so a
// single-account bot needs no refresh dance.
// ─────────────────────────────────────────────────────────────────────────────

const TWEET_URL = "https://api.twitter.com/2/tweets";

export function isXConfigured(): boolean {
  return Boolean(
    process.env.X_API_KEY &&
      process.env.X_API_SECRET &&
      process.env.X_ACCESS_TOKEN &&
      process.env.X_ACCESS_SECRET
  );
}

export interface OAuth1Creds {
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
function pct(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * Build the OAuth 1.0a `Authorization` header for a signed request. `extra`
 * holds any form/query params to sign (none for a JSON-body POST /2/tweets, but
 * needed for the auth endpoints + testability). `nonce`/`ts` are injectable so
 * the signature is deterministic in tests. An empty `token` omits oauth_token
 * (used for the request_token step). Pure — no I/O.
 */
export function oauth1Header(
  method: string,
  url: string,
  creds: OAuth1Creds,
  extra: Record<string, string> = {},
  nonce = crypto.randomBytes(16).toString("hex"),
  ts = Math.floor(Date.now() / 1000).toString()
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: ts,
    oauth_version: "1.0",
  };
  if (creds.token) oauth.oauth_token = creds.token;

  // Signature base string: METHOD&url&sortedParams (oauth + extra), all encoded.
  const all: Record<string, string> = { ...oauth, ...extra };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${pct(k)}=${pct(all[k])}`)
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(paramString)].join("&");
  const signingKey = `${pct(creds.consumerSecret)}&${pct(creds.tokenSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(base)
    .digest("base64");

  const header: Record<string, string> = { ...oauth, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${pct(k)}="${pct(header[k])}"`)
      .join(", ")
  );
}

export interface TweetResult {
  ok: boolean;
  id?: string;
  /** True when no X keys are configured — nothing was attempted. */
  skipped?: boolean;
  error?: string;
}

/**
 * Post a tweet to @looplabsfun (the account whose access tokens are configured).
 * Returns a result rather than throwing, so a failed post never breaks the
 * cycle that triggered it. No-op (skipped) when X isn't configured.
 */
export async function sendTweet(text: string): Promise<TweetResult> {
  if (!isXConfigured()) return { ok: false, skipped: true };
  const creds: OAuth1Creds = {
    consumerKey: process.env.X_API_KEY!,
    consumerSecret: process.env.X_API_SECRET!,
    token: process.env.X_ACCESS_TOKEN!,
    tokenSecret: process.env.X_ACCESS_SECRET!,
  };
  try {
    const res = await fetch(TWEET_URL, {
      method: "POST",
      headers: {
        Authorization: oauth1Header("POST", TWEET_URL, creds),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as {
      data?: { id?: string };
      detail?: string;
      title?: string;
    } | null;
    if (res.ok && json?.data?.id) return { ok: true, id: json.data.id };
    return {
      ok: false,
      error: json?.detail || json?.title || `HTTP ${res.status}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/** Compose + post a project's launch recap. No-op when X isn't configured. */
export async function sendLaunchRecap(
  p: Project,
  opts?: LaunchTweetOptions
): Promise<TweetResult> {
  return sendTweet(buildLaunchTweet(p, opts));
}
