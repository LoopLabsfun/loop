import "server-only";
import { supabaseAdmin } from "./supabase";
import { sendDm } from "./dm";

// Launch waitlist — captures the standing "when can I launch my own project?"
// demand while public launches are closed (lib/launch-config). A signup needs at
// least one way to reach the person (wallet, email, or X handle); the optional
// "idea" is gold (what people want to build → product signal + outreach hook).
//
// Service-role write only (the /api/waitlist route); the table is RLS-locked with
// no read policy, so emails are never publicly readable. Validators are pure +
// exported for unit tests.

export { IDEA_MAX } from "./waitlist-client";
import { IDEA_MAX } from "./waitlist-client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const X_RE = /^[A-Za-z0-9_]{1,15}$/; // X handles: 1–15 of [A-Za-z0-9_]
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface WaitlistInput {
  wallet?: string | null;
  email?: string | null;
  xHandle?: string | null;
  idea?: string | null;
  referrer?: string | null;
}

export interface CleanWaitlist {
  wallet: string | null;
  email: string | null;
  xHandle: string | null;
  idea: string | null;
  referrer: string | null;
}

export function normalizeEmail(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().toLowerCase();
  return t && EMAIL_RE.test(t) && t.length <= 254 ? t : null;
}

export function normalizeXHandle(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim().replace(/^@/, "");
  return t && X_RE.test(t) ? t : null;
}

function normalizeWallet(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return BASE58.test(t) ? t : null;
}

function cap(s: unknown, n: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, n) : null;
}

/**
 * Validate + clean a signup. Returns the cleaned fields, or an `error` string
 * when there's no usable contact (we'd never be able to reach the person). An
 * invalid email/handle is dropped (not fatal) as long as some contact remains.
 */
export function validateWaitlist(input: WaitlistInput): { clean?: CleanWaitlist; error?: string } {
  const wallet = normalizeWallet(input.wallet);
  const email = normalizeEmail(input.email);
  const xHandle = normalizeXHandle(input.xHandle);
  if (!wallet && !email && !xHandle) {
    return { error: "Add a wallet, email, or X handle so we can reach you." };
  }
  return {
    clean: {
      wallet,
      email,
      xHandle,
      idea: cap(input.idea, IDEA_MAX),
      referrer: normalizeWallet(input.referrer) ?? normalizeXHandle(input.referrer),
    },
  };
}

/** The wallet the welcome DM is sent FROM — the official Loop account. Falls back
 *  to PLATFORM_WALLET; when neither is set we just skip the DM (signup still works). */
function dmSender(): string | null {
  const w = (process.env.WAITLIST_DM_SENDER || process.env.PLATFORM_WALLET || "").trim();
  return BASE58.test(w) ? w : null;
}

/** The first-contact DM body. Echoes the person's idea back so the conversation
 *  starts with what THEY care about. Pure + exported for tests. */
export function welcomeDmBody(idea: string | null): string {
  const intro =
    "Welcome to Loop 👋 You're on the launch waitlist — you'll be first in when the factory opens.";
  return idea
    ? `${intro}\n\nYou said you want to build:\n"${idea}"\n\nWhat's the first thing you'd want your agent to ship? Reply here — we read every one.`
    : `${intro}\n\nWhat do you want to build? Reply here — we read every one.`;
}

/** Add someone to the launch waitlist. Idempotent: a duplicate wallet/email is
 *  treated as success ("already on the list"), never an error. On a FRESH signup
 *  that includes a wallet, open a welcome DM from the official account so first
 *  contact happens on our own platform (best-effort — never fails the signup). */
export async function joinWaitlist(
  input: WaitlistInput,
): Promise<{ ok: boolean; error?: string; already?: boolean; messaged?: boolean }> {
  const { clean, error } = validateWaitlist(input);
  if (!clean) return { ok: false, error };
  const sb = supabaseAdmin;
  if (!sb) return { ok: false, error: "Waitlist is not configured yet." };

  const { error: dbErr } = await sb.from("launch_waitlist").insert({
    wallet: clean.wallet,
    email: clean.email,
    x_handle: clean.xHandle,
    idea: clean.idea,
    referrer: clean.referrer,
  });
  if (dbErr) {
    // 23505 = unique violation on the wallet/email index → already signed up.
    if (dbErr.code === "23505" || /duplicate|unique/i.test(dbErr.message)) {
      return { ok: true, already: true };
    }
    return { ok: false, error: dbErr.message };
  }

  // First contact on-platform: open a DM only on a fresh signup that has a wallet
  // identity (DMs are wallet-to-wallet) and only when a sender is configured.
  let messaged = false;
  const sender = dmSender();
  if (clean.wallet && sender && sender !== clean.wallet) {
    try {
      const r = await sendDm(sender, clean.wallet, welcomeDmBody(clean.idea));
      messaged = r.ok;
    } catch {
      /* best-effort: a DM failure must never break the signup */
    }
  }
  return { ok: true, messaged };
}
