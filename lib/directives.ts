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
  role: string;
  status: string;
  for_votes: number;
  against_votes: number;
  quorum: number;
  created_at: string;
}

/** Trim, collapse internal whitespace, and cap at the column limit. */
export function sanitizeDirectiveText(s: string): string {
  return s.trim().replace(/\s+/g, " ").slice(0, DIRECTIVE_TEXT_MAX);
}

/** Short `abcd…wxyz` form of a wallet address, for the feed author label. */
function shortWallet(addr: string): string {
  return addr.length > 9 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

/**
 * Map a persisted directive row to the console FeedItem the UI renders. `at` is
 * supplied by the caller (server) so this stays pure and time-source-agnostic.
 */
export function rowToFeedItem(r: DirectiveRow, at: string): FeedItem {
  const kind = r.kind === "proposal" ? "proposal" : "directive";
  const status: FeedItem["status"] =
    r.status === "applied" ||
    r.status === "adopted" ||
    r.status === "declined" ||
    r.status === "open"
      ? r.status
      : "open";
  const by = r.author_wallet
    ? shortWallet(r.author_wallet)
    : r.role === "founder"
      ? "founder"
      : "holder";
  const item: FeedItem = { id: `d${r.id}`, kind, at, text: r.text, status, by };
  if (kind === "proposal") {
    item.forVotes = r.for_votes ?? 0;
    item.againstVotes = r.against_votes ?? 0;
    item.quorum = r.quorum ?? 100;
  }
  return item;
}
