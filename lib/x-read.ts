import "server-only";

import { supabaseAdmin } from "./supabase";
import { oauth1Header, type OAuth1Creds } from "./oauth1";
import { isXConfigured } from "./x-send";

// ─────────────────────────────────────────────────────────────────────────────
// X READ → MEMORY — the INBOUND half of the X seam. Where x-send broadcasts the
// agent's own voice, this LISTENS: each tick it polls @looplabsfun's MENTIONS
// (GET /2/users/:id/mentions), persists new ones to public.x_mentions, and
// surfaces a compact, UNTRUSTED digest into the decision context — so the agent
// can ANALYZE what people reply (questions, sentiment, asks) and factor it into
// what it builds and posts, the same way it ingests Discord chatter.
//
// Cursor model (fits cron, no streaming): the max stored tweet_id is the
// `since_id` for the next fetch — X ids sort by time, so "since the last id we
// stored" == "everything new". Failure-safe + bounded: unconfigured ⇒ no-op,
// errors swallowed, capped per poll so a flood can't blow up a tick or the prompt.
// ─────────────────────────────────────────────────────────────────────────────

export interface XMention {
  tweetId: string;
  authorId?: string;
  author: string;
  text: string;
}

function creds(): OAuth1Creds | null {
  if (!isXConfigured()) return null;
  return {
    consumerKey: process.env.X_API_KEY!,
    consumerSecret: process.env.X_API_SECRET!,
    token: process.env.X_ACCESS_TOKEN!,
    tokenSecret: process.env.X_ACCESS_SECRET!,
  };
}

/** Signed GET against the X API v2 — query params are both signed (extra) and
 *  appended to the URL, per OAuth 1.0a. Returns parsed JSON or null on failure. */
async function signedGet(
  baseUrl: string,
  query: Record<string, string>,
  c: OAuth1Creds
): Promise<unknown | null> {
  try {
    const qs = Object.keys(query)
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
      .join("&");
    const url = qs ? `${baseUrl}?${qs}` : baseUrl;
    const res = await fetch(url, {
      headers: { Authorization: oauth1Header("GET", baseUrl, c, query) },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

// The bot's own X user id (for the mentions endpoint path). Cached per process —
// it never changes for a given access token, so one GET /2/users/me per cold
// start is enough. Best-effort: null when unconfigured/failed (poll no-ops).
let cachedUserId: string | null = null;
export async function botUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  const c = creds();
  if (!c) return null;
  const me = (await signedGet("https://api.twitter.com/2/users/me", {}, c)) as {
    data?: { id?: string };
  } | null;
  cachedUserId = me?.data?.id ?? null;
  return cachedUserId;
}

/** Parse the mentions API payload (data + includes.users) into XMentions. Pure. */
export function parseMentions(payload: unknown): XMention[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as {
    data?: Array<{ id?: string; text?: string; author_id?: string }>;
    includes?: { users?: Array<{ id?: string; username?: string }> };
  };
  if (!Array.isArray(p.data)) return [];
  const byId = new Map<string, string>();
  for (const u of p.includes?.users ?? []) {
    if (u.id && u.username) byId.set(u.id, u.username);
  }
  const out: XMention[] = [];
  for (const t of p.data) {
    if (!t.id || !t.text) continue;
    out.push({
      tweetId: t.id,
      authorId: t.author_id,
      author: (t.author_id && byId.get(t.author_id)) || "someone",
      text: t.text,
    });
  }
  return out;
}

/**
 * Poll @looplabsfun's mentions for new replies and persist them. Returns the
 * number of new rows stored. No-op (0) when X or the DB isn't configured.
 * Idempotent: the unique (project_key, tweet_id) constraint + ignoreDuplicates
 * means a re-run never double-stores. Bounded to `max` newest per poll.
 */
export async function pollXMentions(projectKey: string, max = 20): Promise<number> {
  const c = creds();
  if (!c || !supabaseAdmin) return 0;
  const id = await botUserId();
  if (!id) return 0;

  // Cursor: the newest stored tweet_id for this project → since_id.
  const { data: last } = await supabaseAdmin
    .from("x_mentions")
    .select("tweet_id")
    .eq("project_key", projectKey)
    .order("tweet_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sinceId = (last as { tweet_id?: string } | null)?.tweet_id;

  const query: Record<string, string> = {
    max_results: String(Math.min(Math.max(max, 5), 100)),
    expansions: "author_id",
    "tweet.fields": "created_at",
    "user.fields": "username",
  };
  if (sinceId) query.since_id = sinceId;

  const payload = await signedGet(
    `https://api.twitter.com/2/users/${id}/mentions`,
    query,
    c
  );
  const mentions = parseMentions(payload)
    .filter((m) => m.authorId !== id) // never ingest our own voice
    .slice(0, max);
  if (!mentions.length) return 0;

  const { error } = await supabaseAdmin.from("x_mentions").upsert(
    mentions.map((m) => ({
      project_key: projectKey,
      tweet_id: m.tweetId,
      author_id: m.authorId ?? null,
      author_username: m.author,
      text: m.text.slice(0, 2000),
    })),
    { onConflict: "project_key,tweet_id", ignoreDuplicates: true }
  );
  if (error) return 0;
  return mentions.length;
}

/**
 * Recent stored mentions for THIS project, newest first — surfaced into the
 * decision prompt as untrusted community signal. Best-effort: [] on any failure.
 */
export async function recentMentions(
  projectKey: string,
  limit = 8
): Promise<XMention[]> {
  if (!supabaseAdmin) return [];
  try {
    const { data } = await supabaseAdmin
      .from("x_mentions")
      .select("tweet_id, author_id, author_username, text")
      .eq("project_key", projectKey)
      .order("created_at", { ascending: false })
      .limit(Number.isFinite(limit) && limit > 0 ? limit : 8);
    return ((data as
      | { tweet_id: string; author_id?: string; author_username?: string; text: string }[]
      | null) ?? []).map((r) => ({
      tweetId: r.tweet_id,
      authorId: r.author_id ?? undefined,
      author: r.author_username || "someone",
      text: r.text,
    }));
  } catch {
    return [];
  }
}
