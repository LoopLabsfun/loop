import type { Project } from "./types";

// Data model for the Agent Console — the conversational steering surface on a
// project page. Pure (no React / no deps) so it's unit-testable; the live state
// lives in the component. This is the simulation seam for what a real agent
// runtime would stream.

export type ConsoleRole = "founder" | "holder" | "spectator";

export type FeedKind = "action" | "escalation" | "directive" | "proposal";

export interface FeedItem {
  id: string;
  kind: FeedKind;
  at: string; // "[HH:MM:SS]" for actions, "just now" / "2m ago" otherwise
  text: string;
  /** escalation/proposal lifecycle */
  status?: "open" | "applied" | "adopted" | "declined";
  by?: string; // author label, e.g. "you (founder)" / "9xQ…a1B"
  /**
   * True only when the author wallet's ownership was proven by signature. An
   * unverified `by` is just a self-declared claim and must NOT be trusted as the
   * founder — the UI marks it accordingly and the runtime never acts on it.
   */
  verified?: boolean;
  /**
   * Matched a prompt-injection pattern (fake system tags, "override guardrails",
   * spoofed sign-off…). Shown as caught/ignored — never executed.
   */
  flagged?: boolean;
  // proposal/escalation tally
  forVotes?: number;
  againstVotes?: number;
  quorum?: number;
}

export interface AgentMandate {
  mission: string;
  model: "Haiku" | "Sonnet" | "Opus";
  budget: string; // e.g. "0.42 SOL/day"
  guardrails: string[];
  /** Founder/DAO content & brand policy applied to everything the agent ships. */
  contentPolicy?: string;
}

/** The non-negotiable guardrails every agent carries, before founder additions. */
export const BASE_GUARDRAILS = [
  "Spend ≤ daily budget",
  "No treasury withdrawals",
  "Never send treasury funds to unknown wallets",
  "Escalate anything irreversible",
];

/**
 * Mandate derived from the project. The founder's stored guardrails (free text,
 * one per line) extend the base set, and their content policy is carried
 * through — both are reread by the runtime every cycle (A4 anti-drift).
 */
export function defaultMandate(p: Project): AgentMandate {
  const founderRails = (p.guardrails ?? "")
    .split("\n")
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 10);
  return {
    mission:
      p.description?.trim() ||
      `Build and grow ${p.name} autonomously, funded by its market.`,
    model: p.official ? "Opus" : "Sonnet",
    budget: p.burnPerDay || "0.40 SOL/day",
    guardrails: [...BASE_GUARDRAILS, ...founderRails],
    contentPolicy: p.contentPolicy?.trim() || undefined,
  };
}

export const ACTION_POOL: string[] = [
  "shipped commit — feat: project page filters",
  "deployed preview build ✓",
  "claimed creator rewards · +0.12 SOL → treasury",
  "ran tests ✓ 41 passed",
  "drafted a reply from the agent inbox",
  "posted a build update to the project feed",
  "opened a PR — chore: dependency bumps",
];

export const ESCALATION_POOL: string[] = [
  "Budget for this sprint is tight — pause outreach to prioritise the core feature?",
  "Two designs scored equally in testing. Ship the bold one or the safe one?",
  "A partner offered a cross-promo. Accept on the agent's authority?",
  "Should I open-source the new module now or after the audit?",
];

export function seedFeed(p: Project): FeedItem[] {
  const t = (m: number) => `${m}m ago`;
  return [
    {
      id: "f1",
      kind: "action",
      at: t(1),
      text: "shipped commit 8f3a21c — feat: add project dashboard",
    },
    {
      id: "f2",
      kind: "action",
      at: t(6),
      text: "claimed rewards · +0.12 SOL → treasury",
    },
    {
      id: "f3",
      kind: "proposal",
      at: t(14),
      text: "Holder proposal: prioritise a mobile build next sprint.",
      status: "open",
      by: "9xQ…a1B",
      forVotes: 62,
      againstVotes: 18,
      quorum: 100,
    },
    {
      id: "f4",
      kind: "escalation",
      at: t(22),
      text:
        p.official
          ? "Should I route 0.3 SOL to a Helius paid tier for faster reads?"
          : "Launch on Product Hunt this week, or wait until the landing page converts better?",
      status: "open",
    },
  ];
}

/** Initial role from wallet state. Founder requires a matching creator wallet. */
export function roleFor(
  connected: boolean,
  address: string | null,
  creatorWallet: string | null | undefined
): ConsoleRole {
  if (!connected) return "spectator";
  if (address && creatorWallet && address === creatorWallet) return "founder";
  return "holder";
}
