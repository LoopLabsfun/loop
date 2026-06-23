// A5 · Cross-project learning — the $LOOP utility beyond governance.
//
// The platform treasury (funded by the 5% of every project's creator rewards)
// pays for a shared "learnings" layer: anonymized, reusable insights mined from
// every agent's runs — what outreach converts, which gates catch real bugs,
// which build patterns ship. Every project agent reads the top learnings each
// cycle, so the whole network compounds. That shared edge — distributed to all
// agents and funded by $LOOP — is what makes $LOOP defensible beyond voting.
//
// Pure + dependency-free so it's unit-testable; the live rows come from the
// `learnings` table (written by the runtime, read by every tick + the UI).

export const LEARNING_CATEGORIES = [
  "outreach",
  "build",
  "growth",
  "gate",
  "ops",
] as const;

export type LearningCategory = (typeof LEARNING_CATEGORIES)[number];

export interface Learning {
  id: string;
  category: LearningCategory;
  insight: string;
  /** Anonymized origin label, e.g. "a gaming project" — never a wallet. */
  source: string;
  upvotes: number;
  at: string;
}

const INSIGHT_MAX = 240;

export function sanitizeLearning(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, INSIGHT_MAX);
}

/** Stable key for dedupe: lowercased, punctuation-insensitive insight. */
export function dedupeKey(insight: string): string {
  return insight.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * True if `insight` is effectively already in `existing` (same dedupe key) — so
 * the write-back path (C) doesn't insert near-identical rows every cycle.
 */
export function isDuplicateLearning(
  insight: string,
  existing: Pick<Learning, "insight">[]
): boolean {
  const key = dedupeKey(sanitizeLearning(insight));
  if (!key) return true; // empty insight: never persist
  return existing.some((l) => dedupeKey(sanitizeLearning(l.insight)) === key);
}

/**
 * Rank for distribution to agents: drop empties, dedupe by insight (keeping the
 * most-upvoted), then sort by upvotes desc (ties → keep input order, which the
 * caller orders by recency). Returns at most `limit`.
 */
export function rankLearnings(list: Learning[], limit = 6): Learning[] {
  const best = new Map<string, Learning>();
  for (const l of list) {
    const insight = sanitizeLearning(l.insight);
    if (!insight) continue;
    const key = dedupeKey(insight);
    const prev = best.get(key);
    if (!prev || l.upvotes > prev.upvotes) best.set(key, { ...l, insight });
  }
  return Array.from(best.values())
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, Math.max(0, limit));
}

/** Render top learnings as prompt context for an agent tick. */
export function formatLearningsForPrompt(list: Learning[]): string {
  const ranked = rankLearnings(list, 6);
  if (!ranked.length) return "(no shared learnings yet)";
  return ranked
    .map((l) => `- (${l.category}) ${l.insight} [${l.upvotes}↑, ${l.source}]`)
    .join("\n");
}
