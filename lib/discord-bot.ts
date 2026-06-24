import "server-only";

import type { DiscordPayload } from "./discord";

// ─────────────────────────────────────────────────────────────────────────────
// DISCORD BOT (REST) — the token-based control layer, on top of the read-only
// webhook in lib/discord-send.ts. Where the webhook can only broadcast, the bot
// can MANAGE the server (create/lay-out channels), POST to any channel, and READ
// message history — all over plain REST so it fits Vercel's serverless/cron model
// (no persistent gateway websocket). Each cron tick is a few REST calls:
//   • ensureChannels  → POST /guilds/{guild}/channels   (idempotent layout)
//   • postToChannel   → POST /channels/{id}/messages
//   • fetchMessagesAfter → GET /channels/{id}/messages?after=<lastId>  (memory)
//
// Server-only: reads DISCORD_BOT_TOKEN / DISCORD_GUILD_ID (no NEXT_PUBLIC_ → never
// ships to the browser). Every call returns a result instead of throwing, so a
// flaky Discord never breaks the agent cycle that triggered it. Unconfigured ⇒
// safe no-op (skipped), exactly like the webhook path.
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://discord.com/api/v10";

// Discord channel type ints (the subset we use). See the channel docs.
export const CHANNEL_TYPE = {
  GUILD_TEXT: 0,
  GUILD_CATEGORY: 4,
  GUILD_ANNOUNCEMENT: 5,
} as const;

/** True when a bot token + guild are configured, i.e. the bot can act. */
export function isDiscordBotConfigured(): boolean {
  return Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
}

export interface DiscordMessage {
  id: string;
  content: string;
  author: { id: string; username: string; bot?: boolean };
  channel_id?: string;
  timestamp: string;
}

interface BotEnv {
  token?: string;
  guildId?: string;
}

function env(): BotEnv {
  return { token: process.env.DISCORD_BOT_TOKEN, guildId: process.env.DISCORD_GUILD_ID };
}

/**
 * One authenticated REST call to the Discord API. Returns the parsed JSON (or
 * null for 204/empty) on success, or throws a tagged Error on a non-2xx — every
 * public function below catches and degrades to a safe result, so callers never
 * see the throw.
 */
async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  token = env().token
): Promise<T> {
  if (!token) throw new Error("discord-bot: no DISCORD_BOT_TOKEN");
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 204) return null as T;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`discord-bot ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** List the guild's channels (used to make channel creation idempotent). */
export async function listChannels(guildId = env().guildId): Promise<DiscordChannel[]> {
  if (!guildId) return [];
  try {
    return (await api<DiscordChannel[]>("GET", `/guilds/${guildId}/channels`)) ?? [];
  } catch {
    return [];
  }
}

/** Deny @everyone the SEND_MESSAGES permission (1<<11) → a read-only channel. */
export function readOnlyOverwrite(guildId: string) {
  return [{ id: guildId, type: 0, deny: String(1 << 11) }]; // @everyone role id == guild id
}

export interface ChannelSpec {
  name: string;
  type?: number;
  /** Category name to nest under (resolved to parent_id at create time). */
  category?: string;
  readOnly?: boolean;
}

export interface EnsureResult {
  ok: boolean;
  skipped?: boolean;
  created: string[];
  existing: string[];
  error?: string;
}

/**
 * The default Loop channel layout. Categories first (so children can nest),
 * then the channels. Idempotent: anything already present (by name) is left
 * untouched, so this is safe to call every tick.
 */
export const DEFAULT_LAYOUT: ChannelSpec[] = [
  { name: "INFO", type: CHANNEL_TYPE.GUILD_CATEGORY },
  { name: "welcome", category: "INFO", readOnly: true },
  { name: "announcements", category: "INFO", type: CHANNEL_TYPE.GUILD_ANNOUNCEMENT, readOnly: true },
  { name: "build-log", category: "INFO", readOnly: true },
  { name: "COMMUNITY", type: CHANNEL_TYPE.GUILD_CATEGORY },
  { name: "general", category: "COMMUNITY" },
  { name: "ideas", category: "COMMUNITY" },
  { name: "governance", category: "COMMUNITY" },
];

/**
 * Create any missing channels from `specs` (idempotent by name). Categories are
 * created first so text channels can resolve their parent. Returns which names
 * were created vs already existed; never throws.
 */
export async function ensureChannels(
  specs: ChannelSpec[] = DEFAULT_LAYOUT,
  guildId = env().guildId
): Promise<EnsureResult> {
  if (!isDiscordBotConfigured() || !guildId) {
    return { ok: false, skipped: true, created: [], existing: [] };
  }
  const created: string[] = [];
  const existing: string[] = [];
  try {
    const current = await listChannels(guildId);
    const byName = new Map(current.map((c) => [c.name.toLowerCase(), c]));

    // Categories first, in two passes, so parents exist before children.
    const ordered = [...specs].sort(
      (a, b) =>
        (a.type === CHANNEL_TYPE.GUILD_CATEGORY ? 0 : 1) -
        (b.type === CHANNEL_TYPE.GUILD_CATEGORY ? 0 : 1)
    );

    for (const spec of ordered) {
      const key = spec.name.toLowerCase();
      if (byName.has(key)) {
        existing.push(spec.name);
        continue;
      }
      const parent = spec.category
        ? byName.get(spec.category.toLowerCase())
        : undefined;
      const payload: Record<string, unknown> = {
        name: spec.name,
        type: spec.type ?? CHANNEL_TYPE.GUILD_TEXT,
      };
      if (parent) payload.parent_id = parent.id;
      if (spec.readOnly) payload.permission_overwrites = readOnlyOverwrite(guildId);
      const made = await api<DiscordChannel>(
        "POST",
        `/guilds/${guildId}/channels`,
        payload
      );
      if (made) byName.set(key, made);
      created.push(spec.name);
    }
    return { ok: true, created, existing };
  } catch (e) {
    return {
      ok: false,
      created,
      existing,
      error: e instanceof Error ? e.message : "ensureChannels failed",
    };
  }
}

/** Find a channel id by (case-insensitive) name; null when absent. */
export async function findChannelId(
  name: string,
  guildId = env().guildId
): Promise<string | null> {
  const chans = await listChannels(guildId);
  return chans.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id ?? null;
}

export interface PostResult {
  ok: boolean;
  skipped?: boolean;
  id?: string;
  error?: string;
}

/**
 * Post a payload (the same DiscordPayload the webhook formatter builds) to a
 * specific channel as the bot. allowed_mentions stays {parse:[]} so the bot can
 * never ping anyone. No-ops when the bot isn't configured.
 */
export async function postToChannel(
  channelId: string,
  payload: DiscordPayload
): Promise<PostResult> {
  if (!process.env.DISCORD_BOT_TOKEN) return { ok: false, skipped: true };
  try {
    // The bot's display name is the application's, not per-message (no username
    // override over the bot API — that's a webhook-only field); drop it.
    const { username: _drop, ...rest } = payload;
    const msg = await api<{ id: string }>(
      "POST",
      `/channels/${channelId}/messages`,
      rest
    );
    return { ok: true, id: msg?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "postToChannel failed" };
  }
}

/**
 * Read up to `limit` messages from a channel newer than `afterId` (oldest-first
 * after sort), for memory ingestion. Returns [] on any failure or when the bot
 * is unconfigured. Pass the last-seen message id to page forward each tick.
 */
export async function fetchMessagesAfter(
  channelId: string,
  afterId?: string,
  limit = 50
): Promise<DiscordMessage[]> {
  if (!process.env.DISCORD_BOT_TOKEN) return [];
  try {
    const qs = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)) });
    if (afterId) qs.set("after", afterId);
    const msgs =
      (await api<DiscordMessage[]>(
        "GET",
        `/channels/${channelId}/messages?${qs.toString()}`
      )) ?? [];
    // Discord returns newest-first; oldest-first is friendlier for sequential
    // ingestion + last-id bookkeeping.
    return msgs.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  } catch {
    return [];
  }
}
