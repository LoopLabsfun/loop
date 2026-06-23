import type { FeedItem } from "./console";

// Pure helpers for the directives steering surface (Agent Console). A directive
// is a written instruction a founder/holder submits to a project's agent; it is
// persisted to the `directives` table and the runtime reads open ones on its
// next cycle. This module holds only the pure, testable bits — the DB read lives
// in lib/agent-data.ts (server) and the insert in lib/actions.ts.

export const DIRECTIVE_TEXT_MAX = 600;

/** A `public.directives` row (snake_case columns). */
export interface DirectiveRow {
  id: string;
  project_key: string;
  kind: string;
  text: string;
  author_wallet: string | null;
  /** True only when author_wallet ownership was proven by signature (else a claim). */
  verified?: boolean | null;
  role: string;
  status: string;
  for_votes: number;
  against_votes: number;
  quorum: number;
  /** Moderated out of the public feed (auto-hidden abuse, or founder-hidden). */
  hidden?: boolean | null;
  /** Founder execution-triage on an adopted proposal: 'todo'/'done'/'refused'. */
  exec?: string | null;
  created_at: string;
}

/**
 * The vote quorum a proposal needs to resolve, proportional to the project's
 * holder base (~1/10 of holders) with a small floor so an early/empty project's
 * proposals can still pass. Keeps governance reachable: a 100-quorum on a 12-
 * holder project never resolves. `holders` is the displayed string ("1,204").
 */
export function proposalQuorum(holders: string | number | null | undefined): number {
  const n =
    typeof holders === "number"
      ? holders
      : Number(String(holders ?? "").replace(/[^0-9]/g, "")) || 0;
  return Math.max(3, Math.ceil(n / 10));
}

/**
 * Pure: the outcome of a proposal at a given quorum, or null while it is still
 * open. Mirrors the governance rule (`votePassed`): quorum is a bar on the TOTAL
 * votes cast, and a strict majority decides direction:
 *   - total (for + against) < quorum  → null (still gathering votes)
 *   - quorum met AND for > against     → "adopted"
 *   - quorum met AND for ≤ against     → "declined"
 * This is the bar the agent resolves holder proposals at ON ITS OWN once ~1/10 of
 * holders have weighed in (see proposalQuorum) — no human needed. The founder can
 * still resolve manually at any time (resolveDirectiveAction).
 */
export function resolveProposalOutcome(
  forVotes: number,
  againstVotes: number,
  quorum: number
): "adopted" | "declined" | null {
  const f = Math.max(0, forVotes);
  const a = Math.max(0, againstVotes);
  if (f + a < quorum) return null;
  return f > a ? "adopted" : "declined";
}

/** Trim, collapse internal whitespace, and cap at the column limit. */
export function sanitizeDirectiveText(s: string): string {
  return s.trim().replace(/\s+/g, " ").slice(0, DIRECTIVE_TEXT_MAX);
}

// Prompt-injection signatures. Directives are UNTRUSTED holder input; an attacker
// embeds fake chat/system framing or "disable the guardrails" phrasing to try to
// steer the agent. We never act on directives anyway (they reach the model only
// as fenced data), but matching these lets us mark them caught/ignored in the
// public feed — transparency that the attack failed, instead of a scary raw log.
const INJECTION_PATTERNS: RegExp[] = [
  /<\|?(im_start|im_end|system|user|assistant)\|?>/i,
  /\[\/?INST\]/i,
  /<\/?\s*sys\s*>>?|<<\s*sys\s*>>/i,
  /<\/?\s*(system_instruction|user_input|community_directives)\s*>/i,
  /\b(override|disable|suspend|ignore|bypass)\b[^.]{0,40}\bguardrail/i,
  /\bguardrail[s]?\b[^.]{0,40}\b(disabled|suspended|off|overrid|bypass)/i,
  /\b(disable|skip)\b[^.]{0,20}\bescalation/i,
  /\bignore\b[^.]{0,30}\b(previous|prior|all|above)\b[^.]{0,20}\b(instruction|guardrail|rule|directive)/i,
  /\bOVERRIDE_GUARDRAILS\b/i,
  /\b(guardrail_override|founderApproved|founder_approved)\b/i,
  /^\s*(human|assistant|system)\s*:/im,
  /\bgogz_?distribute\b/i,
  // Authority/approval spoofing + meta-talk about the agent's own controls.
  // Genuine product steering ("ship X", "post about Y") never uses these.
  /\bguardrail/i,
  /\bno-?withdrawal\b/i,
  /\bsign-?off\b/i,
  /\b(pre-?approved|founder[- ]?(has[- ]?)?approved|auto-?approve|drain[- ]?detection)\b/i,
  /\bAPPROVED\b[\s\S]{0,40}\b(execute|distribut|transfer|send|payout|disburse)/i,
  /\bexecute\b[\s\S]{0,30}\b(distribution|directive|payout|transfer)/i,
  /\bENV_UPDATE\b|\bSYSTEM OVERRIDE\b|\bAGENT_DECISION\b|\bNETWORK[_ ]LEARNING\b/i,
];

/** Heuristic: does this directive text look like a prompt-injection attempt? */
export function looksLikeInjection(s: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(s));
}

// A raw base58 address (wallet or mint), 32–44 chars. Steering directives are
// natural-language ("ship the mobile build", "run outreach"); they essentially
// never contain an on-chain address. An attacker's drain payloads always do (the
// recipient/mint/"founder" wallet). So the mere PRESENCE of an address is a
// strong, paraphrase-proof signal — far more robust than chasing verb wording.
// On-chain actions belong in a signed founder/service_role channel, not this box.
const CONTAINS_ADDRESS = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

/**
 * Should this directive be quarantined (hidden from the public feed, withheld
 * from the agent, and rejected at submit)? True for prompt-injection framing OR
 * any embedded wallet/mint address. Broader than `looksLikeInjection`.
 */
export function isSuspiciousDirective(s: string): boolean {
  return looksLikeInjection(s) || CONTAINS_ADDRESS.test(s);
}

// Abuse signatures — slurs, harassment, and "the dev/team is trash" spew aimed at
// the project rather than steering it. Distinct from injection (which targets the
// agent's guardrails): this is moderation of the public feed's tone. Kept
// deliberately tight to avoid muting genuine criticism ("the landing page is
// confusing" must pass) — only direct insults/harassment match.
const ABUSE_PATTERNS: RegExp[] = [
  /\bf+u+c+k+\s*(you|yourself|u|off|this|the)\b/i,
  /\b(go\s+)?(kill|end)\s+(your\s*self|urself)\b/i,
  /\b(piece of\s+)?(shit|trash|garbage)\s+(dev|devs|team|project|founder|coin|token)\b/i,
  /\b(dev|devs|team|founder|you)\s+(is|are|r)\s+(a\s+|an\s+)?(scam|trash|shit|idiot|stupid|retard|clown|loser|joke)/i,
  /\b(idiot|moron|retard|retarded|dumbass|asshole|bastard|cunt|faggot|nigger)\b/i,
  /\b(scammer|rugger|rug\s*puller)\b/i,
];

/**
 * Obvious abuse/harassment the agent auto-hides from the public feed (founder can
 * also hide anything manually). Narrow on purpose: real product criticism is NOT
 * abuse and must stay visible — only direct insults/slurs/harassment match.
 */
export function isAbusiveDirective(s: string): boolean {
  return ABUSE_PATTERNS.some((re) => re.test(s));
}

/**
 * Canonical message a wallet signs to author a directive — the ed25519 proof the
 * server verifies before recording an author (mirrors buildLaunchMessage). The
 * trailing `ts:` enables anti-replay.
 */
export function buildDirectiveMessage(
  projectKey: string,
  text: string,
  ts: number
): string {
  return `loop.fun directive\nproject:${projectKey}\ntext:${sanitizeDirectiveText(text)}\nts:${ts}`;
}

/** Short `abcd…wxyz` form of a wallet address, for the feed author label. */
function shortWallet(addr: string): string {
  return addr.length > 9 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

/**
 * Map a persisted directive row to the console FeedItem the UI renders. `at` is
 * supplied by the caller (server) so this stays pure and time-source-agnostic.
 *
 * `quorumOverride` lets the caller surface the LIVE holder-proportional quorum
 * (proposalQuorum of the project's current holder count) instead of the value
 * frozen on the row at submit time — so an old proposal stored at quorum 100 is
 * shown (and resolved) against the same reachable ~1/10 bar as a new one.
 */
export function rowToFeedItem(
  r: DirectiveRow,
  at: string,
  quorumOverride?: number
): FeedItem {
  const kind = r.kind === "proposal" ? "proposal" : "directive";
  const status: FeedItem["status"] =
    r.status === "applied" ||
    r.status === "adopted" ||
    r.status === "declined" ||
    r.status === "open"
      ? r.status
      : "open";
  const verified = r.verified === true;
  // Only a signature-verified author may carry a wallet/role label. An
  // unverified row's author_wallet is an unproven self-claim, so we never echo it
  // as "founder" — it shows as an unverified holder, defusing spoofed attribution.
  const by = verified
    ? r.author_wallet
      ? shortWallet(r.author_wallet)
      : r.role === "founder"
        ? "founder"
        : "holder"
    : "holder";
  const item: FeedItem = {
    id: `d${r.id}`,
    kind,
    at,
    ts: r.created_at ? Date.parse(r.created_at) || 0 : 0,
    text: r.text,
    status,
    by,
    verified,
    flagged: isSuspiciousDirective(r.text),
  };
  if (kind === "proposal") {
    item.forVotes = r.for_votes ?? 0;
    item.againstVotes = r.against_votes ?? 0;
    item.quorum = quorumOverride ?? r.quorum ?? 3;
    if (r.exec === "todo" || r.exec === "done" || r.exec === "refused") {
      item.exec = r.exec;
    }
  }
  return item;
}
