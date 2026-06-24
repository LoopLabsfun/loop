import "server-only";

import type { Project } from "./types";
import {
  buildDiscordUpdate,
  buildDiscordLaunch,
  type DiscordPayload,
} from "./discord";
import type { BuildUpdate, LaunchAnnouncement } from "./telegram";

// ─────────────────────────────────────────────────────────────────────────────
// DISCORD SEND PATH — the thin delivery wrapper around the pure formatter in
// lib/discord.ts. Server-only: it reads DISCORD_WEBHOOK_URL (no NEXT_PUBLIC_
// prefix → never ships to the browser) and POSTs to that channel's incoming
// webhook. No bot token, no gateway connection — broadcast only, exactly like
// the Telegram build bot.
//
// When the webhook URL is unset, every send is a safe no-op (skipped) — the app
// and the runtime work uninterrupted with Discord simply not yet configured.
// ─────────────────────────────────────────────────────────────────────────────

/** True when a webhook URL is configured, i.e. messages can actually be sent. */
export function isDiscordConfigured(): boolean {
  return Boolean(process.env.DISCORD_WEBHOOK_URL);
}

export interface DiscordResult {
  ok: boolean;
  /** True when no webhook is configured — nothing was attempted. */
  skipped?: boolean;
  /** HTTP status of a failed attempt. */
  status?: number;
  /** Human-readable failure description, when ok is false. */
  error?: string;
}

/**
 * Execute a Discord webhook with the given payload. Returns a result rather than
 * throwing, so a failing broadcast never breaks the agent cycle that triggered
 * it. No-ops (skipped) when DISCORD_WEBHOOK_URL is unset. Discord replies 204 No
 * Content on success (200 when ?wait=true) — both are treated as ok.
 */
export async function sendDiscordMessage(
  payload: DiscordPayload,
  webhookUrl: string | undefined = process.env.DISCORD_WEBHOOK_URL
): Promise<DiscordResult> {
  if (!webhookUrl) return { ok: false, skipped: true };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (res.ok || res.status === 204) return { ok: true };
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/**
 * Format a project build update (pure formatter) and broadcast it to the
 * project's Discord build-log webhook. Thin glue around buildDiscordUpdate.
 */
export async function sendDiscordBuildUpdate(
  project: Project,
  update: BuildUpdate
): Promise<DiscordResult> {
  return sendDiscordMessage(buildDiscordUpdate(project, update));
}

/**
 * Format a launch announcement (pure formatter) and post it to the project's
 * Discord channel. Thin glue around buildDiscordLaunch — used once, at launch.
 */
export async function sendDiscordLaunch(
  announcement: LaunchAnnouncement
): Promise<DiscordResult> {
  return sendDiscordMessage(buildDiscordLaunch(announcement));
}
