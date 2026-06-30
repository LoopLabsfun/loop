// Pure, dependency-light reconciliation of the agent's task queue against main.
//
// The agent ships a task only when its code lands green and the runtime records
// `hands.pushed` (lib/agent-runtime repo-hands). But the push can race ahead of
// that signal: the E2B sandbox pushes the commit, then times out (or the output
// parse misses the PUSHED marker) before returning — so the commit lands on main
// while the task is left "building". The next tick then re-picks it and re-does
// the work (the observed duplicate `fix(agent): …` commits + the stale "building"
// pile-up). Since the agent commits a task as `${type}(agent): ${title}`, a
// landed task's title is a verbatim substring of its commit's first line — so we
// can detect "already on main" from the recent commits and mark it shipped.
//
// JSX-free + import-free so it's unit-tested in isolation.

export interface ReconcileTask {
  title: string;
  status: string;
}

/** Lowercase + collapse whitespace, for loose title↔commit matching. */
function norm(s: string): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Pure: the titles of `building` tasks whose work already landed — their title
 * appears in a recent commit message. These should be marked shipped (not
 * re-picked). Case- and whitespace-insensitive; a short-title floor avoids
 * matching trivial/near-empty titles against unrelated commits.
 */
export function landedBuildingTitles(
  tasks: ReconcileTask[],
  commits: { msg?: string }[],
  minTitleLen = 12
): string[] {
  const msgs = commits.map((c) => norm(c?.msg ?? ""));
  const out = new Set<string>();
  for (const t of tasks) {
    if (t?.status !== "building") continue;
    const title = norm(t?.title ?? "");
    if (title.length < minTitleLen) continue;
    if (msgs.some((m) => m.includes(title))) out.add(t.title);
  }
  return Array.from(out);
}

export interface AgeTask {
  title: string;
  status: string;
  /** Epoch-ms of the task's last update (when it entered "building"). */
  updatedAtMs: number;
}

/**
 * Pure: titles of `building` tasks that have sat past `maxBuildMs` — well beyond
 * any session wall — and did NOT land (their title isn't in `landedTitles`). The
 * session's finish callback was missed; leaving them "building" leaks phantom
 * in-flight work forever (the `landedBuildingTitles` self-heal only catches an
 * EXACT title↔commit match, so a reworded landing slips through). The caller
 * flips these to a non-building, founder-triage state — never auto-rebuilds them,
 * so a reworded-but-actually-landed task can't be duplicated. Excludes the just-
 * reconciled `landedTitles` so a task is never both shipped and reaped.
 */
export function stalledBuildingTitles(
  tasks: AgeTask[],
  nowMs: number,
  maxBuildMs: number,
  landedTitles: string[] = []
): string[] {
  const landed = new Set(landedTitles.map(norm));
  const out = new Set<string>();
  for (const t of tasks) {
    if (t?.status !== "building") continue;
    if (landed.has(norm(t?.title ?? ""))) continue;
    if (!Number.isFinite(t?.updatedAtMs)) continue;
    if (nowMs - t.updatedAtMs >= maxBuildMs) out.add(t.title);
  }
  return Array.from(out);
}
