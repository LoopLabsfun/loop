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
 * Upvote half-life, days. A learning's effective score halves every 45 days so
 * the network's context window follows what is working NOW: an insight that
 * stopped earning upvotes ages out of the top-6 instead of squatting on it
 * forever, while one that keeps proving itself keeps getting re-upvoted and
 * stays. Fresh entries get +1 so a brand-new insight isn't invisible at 0.
 */
export const LEARNING_HALF_LIFE_DAYS = 45;

/** Time-decayed effective score for ranking (pure; `at` is an ISO timestamp). */
export function decayedScore(
  l: Pick<Learning, "upvotes" | "at">,
  now: number = Date.now()
): number {
  const t = new Date(l.at).getTime();
  const ageDays = Number.isFinite(t) ? Math.max(0, (now - t) / 86_400_000) : 0;
  return (Math.max(0, l.upvotes) + 1) * Math.pow(0.5, ageDays / LEARNING_HALF_LIFE_DAYS);
}

/**
 * Rank for distribution to agents: drop empties, dedupe by insight (keeping the
 * highest effective score), then sort by TIME-DECAYED score desc — recent,
 * still-earning insights outrank stale once-popular ones. Returns at most
 * `limit`. `now` is injectable for tests.
 */
export function rankLearnings(
  list: Learning[],
  limit = 6,
  now: number = Date.now()
): Learning[] {
  const best = new Map<string, Learning>();
  for (const l of list) {
    const insight = sanitizeLearning(l.insight);
    if (!insight) continue;
    const key = dedupeKey(insight);
    const prev = best.get(key);
    if (!prev || decayedScore(l, now) > decayedScore(prev, now)) {
      best.set(key, { ...l, insight });
    }
  }
  return Array.from(best.values())
    .sort((a, b) => decayedScore(b, now) - decayedScore(a, now))
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
