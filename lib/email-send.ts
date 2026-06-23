import "server-only";

import type { Project } from "./types";
import { agentEmail } from "./agent";

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL SEND PATH — the agent's outreach mailbox (`<slug>@agents.looplabs.fun`),
// the email pillar of the autonomous-operator model (the agent writes intros / answers /
// outreach). Server-only: reads RESEND_API_KEY (no NEXT_PUBLIC_ prefix → never
// ships to the browser) and POSTs to Resend's HTTP API.
//
// Like the telegram seam, every send is a safe **no-op (skipped)** when the key
// is unset — the app and the runtime work uninterrupted with email simply not
// yet provisioned. Receiving replies is a separate inbound webhook that needs a
// real domain + Cloudflare Email Routing → see docs/mainnet-readiness.md.
// Cold outreach is judgment-laden, so the runtime should escalate/ gate drafts
// (like the operator model's outreach) before sending, exactly as on-chain actions do.
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://api.resend.com/emails";

/** True when an email provider key is configured, i.e. mail can be sent. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export interface EmailResult {
  ok: boolean;
  /** True when no provider key is configured — nothing was attempted. */
  skipped?: boolean;
  /** Provider message id on success. */
  id?: string;
  /** Human-readable failure description, when ok is false. */
  error?: string;
}

export interface OutboundEmail {
  to: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Optional from override; defaults to the project agent's own mailbox. */
  from?: string;
}

/** The agent's own from-address for a project: `<slug>@agents.looplabs.fun`. */
export function agentFrom(p: Pick<Project, "key" | "ticker">): string {
  return agentEmail(p);
}

// Conservative single-address check (no display names, no commas): the agent
// sends to ONE real-looking recipient or not at all.
const EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/**
 * Validate + clamp an agent-proposed email before an AUTONOMOUS send. Returns a
 * ready outbound payload (sans `from`), or `null` to skip the send. Pure + testable.
 * Guards: a real-looking single recipient, never the agent's own address (no
 * self-loop), and a non-empty subject + body (bounded). The hard send still
 * no-ops without RESEND_API_KEY; this is the content/recipient gate on top.
 */
export function prepareAgentEmail(
  draft: { to?: unknown; subject?: unknown; body?: unknown } | null | undefined,
  selfAddress: string
): { to: string; subject: string; text: string } | null {
  if (!draft || typeof draft !== "object") return null;
  const to = typeof draft.to === "string" ? draft.to.trim().toLowerCase() : "";
  const subject = typeof draft.subject === "string" ? draft.subject.trim() : "";
  const body = typeof draft.body === "string" ? draft.body.trim() : "";
  if (!EMAIL_RE.test(to)) return null;
  if (to === selfAddress.trim().toLowerCase()) return null; // never email itself
  if (!subject || !body) return null;
  return { to, subject: subject.slice(0, 200), text: body.slice(0, 4000) };
}

/**
 * Send an email as the project's agent. Returns a result rather than throwing,
 * so a failing send never breaks the agent cycle that triggered it. No-ops
 * (skipped) when RESEND_API_KEY is unset.
 */
export async function sendAgentEmail(
  p: Pick<Project, "key" | "ticker">,
  email: OutboundEmail
): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: true };

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: email.from ?? agentFrom(p),
        to: email.to,
        subject: email.subject,
        text: email.text,
      }),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as {
      id?: string;
      message?: string;
    } | null;

    if (res.ok && json?.id) return { ok: true, id: json.id };
    return { ok: false, error: json?.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
