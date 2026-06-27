import "server-only";
import { supabaseAdmin } from "./supabase";

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

/** Add someone to the launch waitlist. Idempotent: a duplicate wallet/email is
 *  treated as success ("already on the list"), never an error. */
export async function joinWaitlist(input: WaitlistInput): Promise<{ ok: boolean; error?: string; already?: boolean }> {
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
  return { ok: true };
}
