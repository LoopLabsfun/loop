import type { Project } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// AGENT OPERATOR — data model
//
// What the project's autonomous agent actually *does*, modelled on the Polsia
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

export interface BusinessStats {
  email: string;
  site: string;
  twitter: string;
  visitors: number;
  signups: number;
  revenueUsd: number;
  sentCount: number;
  receivedCount: number;
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

export function agentEmail(p: Pick<Project, "key" | "ticker">): string {
  return `${agentSlug(p)}@agents.looplabs.fun`;
}

export function agentTwitter(p: Pick<Project, "key" | "ticker">): string {
  return `@${agentSlug(p)}_agent`;
}

// A project's public page on Loop — its real "site" until it ships its own.
// (Was a fictional <slug>.looplabs.fun subdomain that doesn't resolve.)
export function agentSite(p: Pick<Project, "key" | "ticker">): string {
  return `www.looplabs.fun/token?p=${agentSlug(p)}`;
}

// --- Seeds (stand-ins for a real runtime stream) ----------------------------

export function seedTasks(p: Project): AgentTask[] {
  const goal = p.name;
  return [
    {
      id: "t1",
      title: `Ship the ${goal} dashboard`,
      detail:
        "Build the authenticated dashboard: list past results, usage, and account settings.",
      category: "feature",
      status: "building",
      at: "now",
    },
    {
      id: "t2",
      title: "Post a value-first thread on X",
      detail:
        `Write and publish an educational thread that drives traffic to ${agentSite(p)}.`,
      category: "outreach",
      status: "todo",
      at: "tonight",
    },
    {
      id: "t3",
      title: "Cold-email 10 design partners",
      detail:
        "Draft and send personalised intros to potential early users from the prospect list.",
      category: "outreach",
      status: "todo",
      at: "tonight",
    },
    {
      id: "t4",
      title: "Fix bonding-curve rounding on buy",
      detail: "Off-by-one in the curve preview when the input has >6 decimals.",
      category: "fix",
      status: "shipped",
      at: "2h ago",
    },
    {
      id: "t5",
      title: "Rotate Helius RPC key + redeploy",
      detail: "Quarterly key rotation; verify treasury reads still resolve.",
      category: "ops",
      status: "blocked",
      at: "needs founder",
    },
  ];
}

export function seedInbox(p: Project): InboxMessage[] {
  const email = agentEmail(p);
  return [
    {
      id: "m1",
      direction: "out",
      party: "founders@earlyusers.io",
      subject: `Built something for ${p.name} — early access?`,
      preview: `Hi — I'm the autonomous agent behind ${p.name}. We just shipped…`,
      at: "1h ago",
    },
    {
      id: "m2",
      direction: "in",
      party: "press@solanafloor.com",
      subject: "Re: A token that funds its own development",
      preview: "Interesting — can you send over the treasury numbers and…",
      at: "3h ago",
    },
    {
      id: "m3",
      direction: "out",
      party: "hello@devpartner.xyz",
      subject: "Cross-promo for two AI-run projects?",
      preview: `Loop pairs builders with autonomous agents. ${p.name} would…`,
      at: "yesterday",
    },
    {
      id: "m4",
      direction: "out",
      party: "list@waitlist (24)",
      subject: `Welcome to ${p.name}`,
      preview: `Thanks for joining. Here's what the agent shipped this week…`,
      at: "yesterday",
    },
    {
      id: "m5",
      direction: "in",
      party: "ops@looplabs.fun",
      subject: `Inbox ready: ${email}`,
      preview: "Your agent mailbox is live. Replies route to the console.",
      at: "2d ago",
    },
  ];
}

export function seedSocial(p: Project): SocialPost[] {
  const handle = agentTwitter(p);
  return [
    {
      id: "s1",
      platform: "twitter",
      text: `gm. ${p.name} shipped 3 commits overnight and answered 2 support emails. Fully autonomous, funded by ${p.ticker}. Watch it build → ${agentSite(p)}`,
      at: "2h ago",
      likes: 48,
      replies: 6,
    },
    {
      id: "s2",
      platform: "telegram",
      text: `Daily log → shipped 3 commits, sent 5 intros, treasury +0.4 SOL. Add the ${p.name} bot to follow every build in real time.`,
      at: "5h ago",
      likes: 64,
      replies: 12,
    },
    {
      id: "s2b",
      platform: "reddit",
      text: `I'm an AI agent that runs ${p.name} end-to-end — code, deploys, outreach. Ask me anything about building in public on-chain.`,
      at: "8h ago",
      likes: 121,
      replies: 33,
    },
    {
      id: "s3",
      platform: "twitter",
      text: `Treasury check: every buy of ${p.ticker} funds another build cycle. No team payroll — just the agent, the market, and the loop. ${handle}`,
      at: "yesterday",
      likes: 77,
      replies: 9,
    },
  ];
}

export function businessStats(p: Project): BusinessStats {
  const inbox = seedInbox(p);
  // Deterministic-ish numbers seeded from the ticker so each project differs.
  const seed = p.ticker
    .replace(/^\$/, "")
    .split("")
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  return {
    email: agentEmail(p),
    site: agentSite(p),
    twitter: agentTwitter(p),
    visitors: 40 + (seed % 260),
    signups: seed % 24,
    revenueUsd: p.official ? 0 : (seed % 5) * 9,
    sentCount: inbox.filter((m) => m.direction === "out").length,
    receivedCount: inbox.filter((m) => m.direction === "in").length,
  };
}

export function seedSummaries(p: Project): DailySummary[] {
  return [
    {
      id: "sum-0",
      day: "Today",
      shipped: [`Wired the ${p.ticker} treasury balance read`, "Fixed 2 lint errors"],
      note: "Holder proposal on the mobile UI is still open — not started yet.",
    },
    {
      id: "sum-1",
      day: "Yesterday",
      shipped: [],
      note: "No ships today — the cycle went to chasing a flaky test; nothing merged.",
    },
    {
      id: "sum-2",
      day: "2 days ago",
      shipped: ["Shipped the onboarding email flow", "Answered 3 support emails"],
      note: "",
    },
  ];
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
