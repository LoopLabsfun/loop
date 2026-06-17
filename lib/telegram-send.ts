import "server-only";

import type { Project } from "./types";
import {
  buildUpdateMessage,
  buildLaunchMessage,
  type BuildUpdate,
  type LaunchAnnouncement,
} from "./telegram";

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM SEND PATH — the thin delivery wrapper around the pure formatter in
// lib/telegram.ts. Server-only: it reads TELEGRAM_BOT_TOKEN (no NEXT_PUBLIC_
// prefix → never ships to the browser) and talks to the Telegram Bot API.
//
// The formatter stays pure and isomorphic; this is the only place that performs
// I/O, so the runtime can call sendBuildUpdate() once a bot token is
// provisioned (see docs/agent-runtime.md §5). When the token is unset, every
// send is a safe no-op — the app and the runtime work uninterrupted with a bot
// simply not yet configured.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.telegram.org";

/** True when a bot token is configured, i.e. messages can actually be sent. */
export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export interface SendResult {
  ok: boolean;
  /** True when no token is configured — nothing was attempted. */
  skipped?: boolean;
  /** Telegram's numeric error code (e.g. 403 blocked, 400 bad request). */
  errorCode?: number;
  /** Human-readable failure description, when ok is false. */
  error?: string;
}

/**
 * Send a MarkdownV2 message to a chat via the Bot API. Returns a result rather
 * than throwing, so a failing broadcast never breaks the agent cycle that
 * triggered it. No-ops (skipped) when TELEGRAM_BOT_TOKEN is unset.
 */
export async function sendTelegramMessage(
  chatId: string | number,
  text: string
): Promise<SendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, skipped: true };

  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error_code?: number;
      description?: string;
    } | null;

    if (res.ok && json?.ok) return { ok: true };
    return {
      ok: false,
      errorCode: json?.error_code ?? res.status,
      error: json?.description ?? `HTTP ${res.status}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/**
 * Format a project build update (pure formatter) and broadcast it to the
 * project's Telegram chat. Thin glue: the formatting lives in lib/telegram.ts,
 * the delivery here.
 */
export async function sendBuildUpdate(
  chatId: string | number,
  project: Project,
  update: BuildUpdate
): Promise<SendResult> {
  return sendTelegramMessage(chatId, buildUpdateMessage(project, update));
}

/**
 * Format a launch announcement (pure formatter) and post it to the project's
 * Telegram chat. Thin glue around buildLaunchMessage — used once, at launch.
 */
export async function sendLaunchAnnouncement(
  chatId: string | number,
  announcement: LaunchAnnouncement
): Promise<SendResult> {
  return sendTelegramMessage(chatId, buildLaunchMessage(announcement));
}
