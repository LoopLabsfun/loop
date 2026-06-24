import type { Project } from "./types";
import type { AgentTask } from "./agent";
import { agentSite } from "./agent";
import type { BuildUpdate, LaunchAnnouncement } from "./telegram";

// ─────────────────────────────────────────────────────────────────────────────
// DISCORD SEAM — read-only per-project build-log, delivered via an incoming
// webhook (no always-on bot/gateway). This is the Discord counterpart of
// lib/telegram.ts: the pure, testable part — it formats REAL agent state into a
// Discord webhook payload. The actual POST lives in lib/discord-send.ts (the only
// place that does I/O), so this stays isomorphic and unit-testable.
//
// Discord uses plain Markdown (no MarkdownV2 escaping). We never let the agent
// ping anyone: every payload sets allowed_mentions to an empty parse list.
// ─────────────────────────────────────────────────────────────────────────────

// Discord hard limits we clamp to (see the webhook docs): content ≤ 2000,
// embed.description ≤ 4096, embed.title ≤ 256, field.value ≤ 1024.
const MAX_CONTENT = 2000;
const MAX_DESC = 4096;
const MAX_FIELD = 1024;
const MAX_LINES = 5;

// Brand accent (violet) + status colours, as 24-bit ints for Discord embeds.
const COLOR_DEFAULT = 0x6d4aff;
const COLOR_SHIPPED = 0x22c55e;
const COLOR_BUILDING = 0xf59e0b;

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

/** A Discord webhook execute payload (the subset we use). */
export interface DiscordPayload {
  /** Per-message display name override for the webhook. */
  username?: string;
  content?: string;
  embeds?: DiscordEmbed[];
  /** Always set to { parse: [] } so the agent can never @mention anyone. */
  allowed_mentions: { parse: [] };
}

function clamp(s: string, max: number): string {
  const t = (s ?? "").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** The webhook display name for a project's agent, e.g. "LOOP agent". */
export function discordUsername(p: Pick<Project, "name">): string {
  return `${p.name} agent`;
}

const NO_PING = { parse: [] as [] };

/**
 * Wrap a dev-log the AGENT wrote itself (its own voice — the same note it would
 * post to Telegram) as a Discord webhook payload. The agent's words ARE the
 * post; we only clamp the body and append the watch-link footer. Use this when
 * the agent supplied an authored note; otherwise fall back to
 * buildDiscordProgress / buildDiscordUpdate.
 */
export function composeAgentDiscord(p: Project, text: string): DiscordPayload {
  const body = clamp(text ?? "", MAX_CONTENT - 80);
  const content = `${body}\n\nWatch it build → ${agentSite(p)}`;
  return {
    username: discordUsername(p),
    content: clamp(content, MAX_CONTENT),
    allowed_mentions: NO_PING,
  };
}

/**
 * Format an honest BUILD-IN-PUBLIC progress note (what the agent is working on
 * right now) as a Discord embed. Unlike buildDiscordUpdate this does NOT claim
 * "shipped" — it lets the agent post frequently while the timeline stays truthful.
 */
export function buildDiscordProgress(
  p: Project,
  work: { title: string; detail?: string }
): DiscordPayload {
  const detail = (work.detail ?? "").trim();
  const description = detail ? clamp(detail, MAX_DESC) : undefined;
  return {
    username: discordUsername(p),
    embeds: [
      {
        title: clamp(`🛠️ ${p.name} — building`, 256),
        description: description
          ? `**${clamp(work.title, 200)}**\n${description}`
          : `**${clamp(work.title, 200)}**`,
        color: COLOR_BUILDING,
        url: agentSite(p),
        footer: { text: "Watch it build → looplabs.fun" },
      },
    ],
    allowed_mentions: NO_PING,
  };
}

/**
 * Format a read-only build update (shipped tasks / commits / treasury) as a
 * Discord embed. Empty sections are omitted; an empty update still yields a valid
 * header + watch link. The Discord counterpart of telegram.buildUpdateMessage.
 */
export function buildDiscordUpdate(p: Project, u: BuildUpdate): DiscordPayload {
  const fields: { name: string; value: string }[] = [];

  const shipped = (u.shipped ?? []).slice(0, MAX_LINES) as AgentTask[];
  if (shipped.length) {
    fields.push({
      name: "✅ Shipped",
      value: clamp(shipped.map((t) => `• ${t.title}`).join("\n"), MAX_FIELD),
    });
  }

  const commits = u.commits ?? [];
  if (commits.length) {
    fields.push({
      name: `📦 ${commits.length} commit${commits.length === 1 ? "" : "s"}`,
      value: clamp(
        commits.slice(0, MAX_LINES).map((c) => `• ${c.message}`).join("\n"),
        MAX_FIELD
      ),
    });
  }

  if (typeof u.treasurySol === "number") {
    let delta = "";
    if (typeof u.treasuryDeltaSol === "number" && u.treasuryDeltaSol !== 0) {
      const sign = u.treasuryDeltaSol > 0 ? "+" : "";
      delta = ` (${sign}${u.treasuryDeltaSol.toFixed(2)})`;
    }
    fields.push({ name: "💰 Treasury", value: `${u.treasurySol.toFixed(2)} SOL${delta}` });
  }

  return {
    username: discordUsername(p),
    embeds: [
      {
        title: clamp(`🤖 ${p.name} build update`, 256),
        color: COLOR_SHIPPED,
        url: agentSite(p),
        fields,
        footer: { text: "Watch it build → looplabs.fun" },
      },
    ],
    allowed_mentions: NO_PING,
  };
}

/**
 * Format a one-shot launch announcement (posted when a project's token goes
 * live) as a Discord embed — the Discord counterpart of telegram.buildLaunchMessage.
 * The CA (in a copy-paste code span) and the trade link are always included.
 */
export function buildDiscordLaunch(a: LaunchAnnouncement): DiscordPayload {
  const desc = (a.description ?? "").trim();
  const lines = [
    desc ? clamp(desc, 1500) : "",
    "",
    `CA: \`${a.mint}\``,
    `Trade → ${a.url}`,
  ].filter((l) => l !== undefined);
  return {
    embeds: [
      {
        title: clamp(`🚀 $${a.symbol} is live on pump.fun`, 256),
        description: clamp(lines.join("\n"), MAX_DESC),
        color: COLOR_DEFAULT,
      },
    ],
    allowed_mentions: NO_PING,
  };
}

/**
 * The signature string used to dedup a payload against the last post (the body
 * we store in agent_posts). Mirrors what a holder actually sees: the authored
 * content, or the embed description, or the joined embed fields.
 */
export function discordSignature(payload: DiscordPayload): string {
  if (payload.content) return payload.content;
  const e = payload.embeds?.[0];
  if (!e) return "";
  if (e.description) return e.description;
  return (e.fields ?? []).map((f) => `${f.name}: ${f.value}`).join("\n");
}
