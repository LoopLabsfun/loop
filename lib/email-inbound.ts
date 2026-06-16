// ─────────────────────────────────────────────────────────────────────────────
// EMAIL INBOUND — the receiving half of the agent mailbox (`<slug>@agents.loop.fun`).
//
// The send path (email-send.ts) lets the agent write out; this is how replies
// come back in. A real domain + Cloudflare Email Routing (or Resend inbound)
// forwards each message to a webhook (app/api/email/inbound) which maps it to a
// project and stores it in `agent_emails` (direction "in"), so the runtime can
// read + answer it and the UI shows the conversation.
//
// This module is the pure parsing/validation seam — no I/O, so it's unit-testable
// and the route stays thin. It (1) extracts the project slug from the recipient
// address and (2) builds a safe, length-clamped `agent_emails` row. The route
// resolves the slug to a real project (by agentSlug) and inserts via service-role.
// ─────────────────────────────────────────────────────────────────────────────

export const AGENT_EMAIL_DOMAIN = "agents.loop.fun";
export const SUBJECT_MAX = 200;
export const PREVIEW_MAX = 280;
export const PARTY_MAX = 200;

/** A raw inbound webhook payload (provider-agnostic; the worker maps to this). */
export interface InboundPayload {
  /** Recipient, e.g. `loop@agents.loop.fun` or `"Agent" <loop@agents.loop.fun>`. */
  to?: string | null;
  /** Sender address (the conversation party). */
  from?: string | null;
  subject?: string | null;
  /** Plain-text body (used to derive the preview). */
  text?: string | null;
}

/** Unwrap a `Name <addr@host>` form to the bare address, lowercased + trimmed. */
function bareAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

/**
 * The normalized agent slug from a `<slug>@agents.loop.fun` recipient, matching
 * `agentSlug` (lowercase, alphanumerics only). `null` when `to` isn't an agent
 * address (wrong domain / malformed) — the route rejects those.
 */
export function slugFromAgentAddress(to?: string | null): string | null {
  if (!to) return null;
  const addr = bareAddress(String(to));
  const at = addr.indexOf("@");
  if (at <= 0) return null;
  if (addr.slice(at + 1) !== AGENT_EMAIL_DOMAIN) return null;
  const slug = addr.slice(0, at).replace(/[^a-z0-9]/g, "");
  return slug || null;
}

export interface InboundEmailInsert {
  project_key: string;
  direction: "in";
  party: string;
  subject: string;
  preview: string;
}

/** Collapse whitespace and clamp to `max`, never returning null/undefined. */
function clamp(s: string | null | undefined, max: number): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Build the `agent_emails` "in" row for an already-resolved project. Pure: the
 * caller resolves `projectKey` from `slugFromAgentAddress`; this sanitizes and
 * length-clamps the stored fields so a hostile webhook can't bloat the table.
 */
export function inboundRow(
  projectKey: string,
  p: InboundPayload
): InboundEmailInsert {
  return {
    project_key: projectKey,
    direction: "in",
    party: clamp(p.from ? bareAddress(String(p.from)) : "", PARTY_MAX) || "unknown",
    subject: clamp(p.subject, SUBJECT_MAX) || "(no subject)",
    preview: clamp(p.text, PREVIEW_MAX),
  };
}
