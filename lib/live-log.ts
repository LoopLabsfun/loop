// Pure, client-safe matcher tying a "shipped" agent task to the commit that
// proves it. The agent commits a task as `${type}(agent): ${title}`, so a
// landed task's title is a verbatim (case/whitespace-insensitive) substring of
// its commit's first line — the same signal lib/task-reconcile uses. The LIVE
// LOG uses this to link a shipped row to its GitHub commit; a shipped row with
// NO matchable commit is shown without the "shipped" claim (we can't prove it).
//
// No imports / no "server-only" so the client AgentEngine can use it directly.

/** Lowercase + collapse whitespace, for loose title↔commit matching. */
function norm(s: string): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

export interface MatchCommit {
  hash: string;
  msg: string;
}

/**
 * The short SHA of the first commit whose message contains `title` (normalized),
 * or null when none matches. A short-title floor avoids matching trivial titles
 * against unrelated commits. Pure; exported for testing.
 */
export function commitHashForTitle(
  title: string,
  commits: MatchCommit[],
  minTitleLen = 12
): string | null {
  const t = norm(title);
  if (t.length < minTitleLen) return null;
  for (const c of commits) {
    if (norm(c?.msg ?? "").includes(t)) return c?.hash ?? null;
  }
  return null;
}
