import type { Project } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// AGENT OPERATOR — data model
//
// What the project's autonomous agent actually *does*, modelled on the autonomous-operator
// pattern: it ships code, runs outreach, keeps its own email inbox, manages a
// social presence, and reports honest daily summaries. This is the simulation
// seam — pure, no React, no network — so it can be wired to a real agent
// runtime later (see docs/agent-runtime.md) without touching the UI.
//
// Each project gets a dedicated agent identity:
//   email:   <slug>@agents.looplabs.fun
//   socials: @<slug>_agent
// derived deterministically from the project key.
// ─────────────────────────────────────────────────────────────────────────────

export type TaskCategory = "feature" | "outreach" | "fix" | "ops";
export type TaskStatus = "todo" | "building" | "shipped" | "blocked";

export interface AgentTask {
  id: string;
  title: string;
  detail: string;
  category: TaskCategory;
  status: TaskStatus;
  /** human label, e.g. "tonight", "2h ago" */
  at: string;
  /**
   * Verifier outcome of the most recent tick on this task (episodic memory) —
   * e.g. "last attempt FAILED tsc — error TS2345…" or "held: no check ran".
   * Fed back into the agent's next prompt so it adapts instead of re-planning
   * the same thing. Undefined until a tick records one.
   */
  lastOutcome?: string;
}

export type Channel = "email" | "twitter" | "reddit";

export interface InboxMessage {
  id: string;
  direction: "out" | "in";
  /** counterpart address/handle */
  party: string;
  subject: string;
  preview: string;
  at: string;
}

export interface SocialPost {
  id: string;
  platform: "twitter" | "reddit" | "telegram" | "farcaster";
  text: string;
  at: string;
  likes: number;
  replies: number;
}

/** An honest per-cycle summary: what shipped AND what didn't. */
export interface DailySummary {
  id: string;
  day: string; // "Today", "Yesterday", "2 days ago"
  shipped: string[]; // may be empty — "no ships" is a valid, honest day
  note: string; // what didn't ship / blockers / why ("" when nothing notable)
}

/** Deterministic agent slug from a project key/ticker (lowercase a-z0-9). */
export function agentSlug(p: Pick<Project, "key" | "ticker">): string {
  const raw = (p.key || p.ticker || "agent").toString();
  const s = raw.replace(/^\$/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return s || "agent";
}

/**
 * The mail domain the agent sends/receives on. Must match a domain VERIFIED in
 * Resend, or every send 4xx's ("domain not verified"). Default keeps today's
 * `agents.looplabs.fun`; override with `NEXT_PUBLIC_AGENT_EMAIL_DOMAIN` (public,
 * non-secret — and public so the client-rendered identity row matches the server
 * send-from) to point at whatever you actually verified, e.g. `looplabs.fun` or
 * `mail.looplabs.fun`. Keep it in sync with the inbound router's domain.
 */
export const DEFAULT_AGENT_EMAIL_DOMAIN = "agents.looplabs.fun";
export function agentEmailDomain(): string {
  return (
    process.env.NEXT_PUBLIC_AGENT_EMAIL_DOMAIN?.trim() ||
    DEFAULT_AGENT_EMAIL_DOMAIN
  );
}

export function agentEmail(p: Pick<Project, "key" | "ticker">): string {
  return `${agentSlug(p)}@${agentEmailDomain()}`;
}

export function agentTwitter(p: Pick<Project, "key" | "ticker">): string {
  return `@${agentSlug(p)}_agent`;
}

// A project's public page on Loop — its real "site" until it ships its own.
// (Was a fictional <slug>.looplabs.fun subdomain that doesn't resolve.)
export function agentSite(p: Pick<Project, "key" | "ticker">): string {
  return `www.looplabs.fun/token?p=${agentSlug(p)}`;
}

export const CATEGORY_LABEL: Record<TaskCategory, string> = {
  feature: "feature",
  outreach: "outreach",
  fix: "fix",
  ops: "ops",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "Queued",
  building: "Building",
  shipped: "Shipped",
  blocked: "Needs founder",
};
