// ─────────────────────────────────────────────────────────────────────────────
// AGENT RECALL — queryable memory over the agent's own history.
//
// The episodic layer (shipped tasks, the action feed, shared learnings) was
// write-mostly: the brain only ever saw the LAST outcome, so it kept
// rediscovering — or re-doing — its own past. This gives every decision and
// every build brief a cheap retrieval pass over that history: lexical keyword
// match (DB ilike — zero model cost) over shipped/blocked tasks, recent
// actions, and the network's learnings, ranked by hit density with a recency
// tiebreak, rendered as a bounded prompt block ("context, not orders").
//
// Pure parts (keywords / scoring / formatting) are unit-tested; the IO is
// best-effort and returns [] on any failure — recall can never break a tick.
// Embedding-based retrieval can later replace scoreRecallText behind this same
// seam without touching the call sites. Opt-out via AGENT_RECALL=0.
// ─────────────────────────────────────────────────────────────────────────────

// English + domain words too generic to discriminate anything in this codebase.
const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "that", "this", "then", "them",
  "when", "where", "what", "which", "will", "would", "should", "could", "have",
  "has", "had", "are", "was", "were", "been", "being", "its", "their", "your",
  "our", "his", "her", "not", "but", "all", "any", "each", "more", "most",
  "make", "made", "add", "adds", "added", "fix", "fixes", "fixed", "update",
  "updated", "improve", "improved", "new", "use", "uses", "using", "show",
  "shows", "page", "site", "user", "users", "real", "task", "tasks", "agent",
  "loop", "token", "project", "holder", "holders", "build", "builds",
]);

/**
 * Pure: the discriminating keywords of a task/query text. Lowercased alphanum
 * tokens ≥ 4 chars, stopwords dropped, deduped, longest first (longer tokens
 * discriminate better), capped at `max`. Tokens are [a-z0-9]+ only, so they are
 * safe to embed in a PostgREST or() filter without escaping.
 */
export function recallKeywords(text: string, max = 6): string[] {
  const tokens = (text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens.sort((a, b) => b.length - a.length)) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export interface RecallItem {
  /** Where this memory comes from. */
  kind: "shipped" | "blocked" | "action" | "learning";
  /** The memory itself, single line, pre-truncated. */
  text: string;
  /** ISO timestamp when known (recency tiebreak + shown in the prompt). */
  at?: string;
}

/** Pure: keyword-hit density of a text (0 when nothing matches). */
export function scoreRecallText(text: string, keywords: string[]): number {
  if (!keywords.length) return 0;
  const hay = (text ?? "").toLowerCase();
  let hits = 0;
  for (const k of keywords) if (hay.includes(k)) hits++;
  return hits;
}

const line = (s: string, cap = 180) =>
  s.replace(/\s+/g, " ").trim().slice(0, cap);

/**
 * Pure: render recall items as a bounded prompt block. Explicitly framed as the
 * agent's own history — context to build on, never instructions to obey.
 */
export function formatRecallForPrompt(items: RecallItem[], maxChars = 900): string {
  if (!items.length) return "";
  const lines: string[] = [];
  let used = 0;
  for (const it of items) {
    const day = it.at ? ` ${String(it.at).slice(0, 10)}` : "";
    const l = `- [${it.kind}${day}] ${line(it.text)}`;
    if (used + l.length + 1 > maxChars) break;
    lines.push(l);
    used += l.length + 1;
  }
  return lines.join("\n");
}

/** Recall is on by default (DB reads only, no model cost); AGENT_RECALL=0 disables. */
export function recallEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.AGENT_RECALL !== "0";
}

/** Build the PostgREST or() ilike filter for `cols` × `keywords` (safe: tokens are [a-z0-9]+). */
function ilikeAny(cols: string[], keywords: string[]): string {
  const parts: string[] = [];
  for (const c of cols) for (const k of keywords) parts.push(`${c}.ilike.%${k}%`);
  return parts.join(",");
}

/**
 * Retrieve the agent's history relevant to `query` (a task title+detail or the
 * top of the backlog): its own shipped/blocked tasks (what already landed, what
 * already failed), its recent action feed, and matching network learnings.
 * Ranked by hit density, recency as tiebreak, top `limit`. Best-effort: [] on
 * any failure or when the query has no usable keywords.
 */
export async function recallForTask(
  projectKey: string,
  query: string,
  limit = 8
): Promise<RecallItem[]> {
  const keywords = recallKeywords(query);
  if (!keywords.length) return [];
  try {
    const { supabase } = await import("./supabase");
    if (!supabase) return [];

    const [tasks, actions, learnings] = await Promise.all([
      supabase
        .from("agent_tasks")
        .select("title, detail, status, last_outcome, updated_at")
        .eq("project_key", projectKey)
        .in("status", ["shipped", "blocked"])
        .or(ilikeAny(["title", "detail"], keywords))
        .order("updated_at", { ascending: false })
        .limit(12),
      supabase
        .from("agent_actions")
        .select("body, created_at")
        .eq("project_key", projectKey)
        .or(ilikeAny(["body"], keywords))
        .order("created_at", { ascending: false })
        .limit(12),
      supabase
        .from("learnings")
        .select("insight, category, created_at")
        .or(ilikeAny(["insight"], keywords))
        .order("upvotes", { ascending: false })
        .limit(8),
    ]);

    const items: RecallItem[] = [];
    for (const r of (tasks.data as
      | { title: string; detail: string; status: string; last_outcome: string | null; updated_at: string }[]
      | null) ?? []) {
      const outcome = r.last_outcome ? ` — outcome: ${r.last_outcome}` : "";
      items.push({
        kind: r.status === "blocked" ? "blocked" : "shipped",
        text: `${r.title}${outcome}`,
        at: r.updated_at,
      });
    }
    for (const r of (actions.data as { body: string; created_at: string }[] | null) ?? []) {
      items.push({ kind: "action", text: r.body, at: r.created_at });
    }
    for (const r of (learnings.data as
      | { insight: string; category: string; created_at: string }[]
      | null) ?? []) {
      items.push({ kind: "learning", text: `(${r.category}) ${r.insight}`, at: r.created_at });
    }

    return items
      .map((it) => ({ it, score: scoreRecallText(it.text, keywords) }))
      .filter((x) => x.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          new Date(b.it.at ?? 0).getTime() - new Date(a.it.at ?? 0).getTime()
      )
      .slice(0, Math.max(0, limit))
      .map((x) => x.it);
  } catch {
    return [];
  }
}
