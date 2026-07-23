import "server-only";

import type { Project } from "./types";
import { oauth1Header, type OAuth1Creds } from "./oauth1";
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
// v2 media upload (the v1.1 upload.twitter.com endpoint was retired); OAuth 1.0a
// user context works here too. Multipart: only the oauth_* params are signed,
// which is exactly what oauth1Header() produces with no `extra`.
const MEDIA_UPLOAD_URLS = [
  "https://api.x.com/2/media/upload",
  "https://upload.twitter.com/1.1/media/upload.json", // legacy fallback
];

export function isXConfigured(): boolean {
  return Boolean(
    process.env.X_API_KEY &&
      process.env.X_API_SECRET &&
      process.env.X_ACCESS_TOKEN &&
      process.env.X_ACCESS_SECRET
  );
}

export interface TweetResult {
  ok: boolean;
  id?: string;
  /** True when no X keys are configured — nothing was attempted. */
  skipped?: boolean;
  error?: string;
}

export interface MediaUploadResult {
  ok: boolean;
  mediaId?: string;
  skipped?: boolean;
  error?: string;
}

/**
 * Upload an image so it can be attached to a tweet (media.media_ids). Tries the
 * v2 endpoint first, then the legacy v1.1 one — both accept OAuth 1.0a user
 * context and a multipart `media` field. An uploaded id that's never attached
 * simply expires server-side, so a dry-run upload test is harmless.
 */
export async function uploadTweetMedia(
  bytes: Uint8Array,
  mimeType: string,
  filename = "media"
): Promise<MediaUploadResult> {
  if (!isXConfigured()) return { ok: false, skipped: true };
  const creds: OAuth1Creds = {
    consumerKey: process.env.X_API_KEY!,
    consumerSecret: process.env.X_API_SECRET!,
    token: process.env.X_ACCESS_TOKEN!,
    tokenSecret: process.env.X_ACCESS_SECRET!,
  };
  let lastError = "no endpoint reachable";
  for (const url of MEDIA_UPLOAD_URLS) {
    try {
      const form = new FormData();
      form.append("media", new Blob([bytes], { type: mimeType }), filename);
      form.append("media_category", "tweet_image");
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: oauth1Header("POST", url, creds) },
        body: form,
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as {
        // v2 shape                       // v1.1 shape
        data?: { id?: string };
        media_id_string?: string;
        detail?: string;
        title?: string;
        errors?: { message?: string }[];
      } | null;
      const mediaId = json?.data?.id || json?.media_id_string;
      if (res.ok && mediaId) return { ok: true, mediaId };
      lastError =
        json?.detail || json?.title || json?.errors?.[0]?.message || `HTTP ${res.status}`;
      // 404 = endpoint gone on this host → try the next; anything else is real.
      if (res.status !== 404) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "network error";
    }
  }
  return { ok: false, error: lastError };
}

export interface TweetExtras {
  /** Quote-tweet this id (the quoted post renders under the text). */
  quoteTweetId?: string;
  /** Media ids from uploadTweetMedia to attach (images render in the tweet). */
  mediaIds?: string[];
}

/**
 * Post a tweet to @looplabsfun (the account whose access tokens are configured).
 * Returns a result rather than throwing, so a failed post never breaks the
 * cycle that triggered it. No-op (skipped) when X isn't configured.
 */
export async function sendTweet(
  text: string,
  replyToId?: string,
  extras?: TweetExtras
): Promise<TweetResult> {
  if (!isXConfigured()) return { ok: false, skipped: true };
  const creds: OAuth1Creds = {
    consumerKey: process.env.X_API_KEY!,
    consumerSecret: process.env.X_API_SECRET!,
    token: process.env.X_ACCESS_TOKEN!,
    tokenSecret: process.env.X_ACCESS_SECRET!,
  };
  try {
    // Chain a thread by replying to the prior tweet when replyToId is given;
    // quote + media are additive (a quote-tweet with an image carries both).
    const payload: Record<string, unknown> = { text };
    if (replyToId) payload.reply = { in_reply_to_tweet_id: replyToId };
    if (extras?.quoteTweetId) payload.quote_tweet_id = extras.quoteTweetId;
    if (extras?.mediaIds?.length) payload.media = { media_ids: extras.mediaIds };
    const res = await fetch(TWEET_URL, {
      method: "POST",
      headers: {
        Authorization: oauth1Header("POST", TWEET_URL, creds),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
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

/**
 * Delete a tweet by id (DELETE /2/tweets/:id), same OAuth1 user context as
 * sendTweet. Returns a result rather than throwing. Used to tidy up a thread the
 * runtime/operator wants to repost cleanly. No-op (skipped) when unconfigured.
 */
export async function deleteTweet(id: string): Promise<TweetResult> {
  if (!isXConfigured()) return { ok: false, skipped: true };
  const creds: OAuth1Creds = {
    consumerKey: process.env.X_API_KEY!,
    consumerSecret: process.env.X_API_SECRET!,
    token: process.env.X_ACCESS_TOKEN!,
    tokenSecret: process.env.X_ACCESS_SECRET!,
  };
  const url = `${TWEET_URL}/${id}`;
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: oauth1Header("DELETE", url, creds) },
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as {
      data?: { deleted?: boolean };
      detail?: string;
      title?: string;
    } | null;
    if (res.ok && json?.data?.deleted) return { ok: true, id };
    return { ok: false, error: json?.detail || json?.title || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/**
 * Verify the configured X credentials by calling GET /2/users/me. Returns the
 * HTTP status (200 = valid) or null when unconfigured — diagnostics only, never
 * exposes the keys. Distinguishes "wrong/truncated creds" (401/403) from a
 * post-specific failure (200 here but POST fails).
 */
export async function verifyXCredentials(): Promise<number | null> {
  if (!isXConfigured()) return null;
  const creds: OAuth1Creds = {
    consumerKey: process.env.X_API_KEY!,
    consumerSecret: process.env.X_API_SECRET!,
    token: process.env.X_ACCESS_TOKEN!,
    tokenSecret: process.env.X_ACCESS_SECRET!,
  };
  const url = "https://api.twitter.com/2/users/me";
  try {
    const res = await fetch(url, {
      headers: { Authorization: oauth1Header("GET", url, creds) },
      cache: "no-store",
    });
    return res.status;
  } catch {
    return null;
  }
}

/** Compose + post a project's launch recap. No-op when X isn't configured. */
export async function sendLaunchRecap(
  p: Project,
  opts?: LaunchTweetOptions
): Promise<TweetResult> {
  return sendTweet(buildLaunchTweet(p, opts));
}
