// ─────────────────────────────────────────────────────────────────────────────
// EPICS — multi-tick planning for work too big to ship in one cycle.
//
// The agent thinks tick by tick; real features take ten ticks. Without a plan
// shape it either bit off a whole feature (timeout, half-shipped) or nibbled
// low-altitude fragments. With epics, the decision can answer "this is too big
// for one cycle" by returning a PLAN instead of building: the oversized backlog
// item flips to status "planned" (a parent, never picked directly) and 2..6
// concrete, one-cycle subtasks land as normal `todo` rows pointing at it
// (agent_tasks.parent_id). Subtasks then flow through the ordinary ranked loop;
// when the LAST one ships, the cron's reconcile pass flips the parent to
// shipped with a summary outcome.
//
// Opt-in via AGENT_EPICS=1 (it changes decision behavior). Validation is pure +
// unit-tested; IO is bounded + best-effort. The reconcile pass is a cheap
// always-on no-op while no "planned" rows exist.
// ─────────────────────────────────────────────────────────────────────────────

import type { TaskCategory } from "./agent";
import type { Project } from "./types";

export function epicsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.AGENT_EPICS === "1";
}

export interface EpicSubtask {
  title: string;
  detail: string;
  category: TaskCategory;
}

export interface EpicPlan {
  /** MUST match an open backlog item's title — the row that becomes the parent. */
  title: string;
  subtasks: EpicSubtask[];
}

const CATEGORIES: TaskCategory[] = ["feature", "outreach", "fix", "ops"];

/**
 * Pure: validate + clamp a model-returned epic plan. Null when unusable
 * (missing title, fewer than 2 or more than 6 usable subtasks, duplicate
 * subtask titles collapse). Categories coerce to "feature" when invalid.
 */
export function validateEpicPlan(raw: unknown): EpicPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim().slice(0, 120) : "";
  if (!title) return null;
  const seen = new Set<string>();
  const subtasks: EpicSubtask[] = [];
  for (const s of Array.isArray(r.subtasks) ? r.subtasks : []) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const st = typeof o.title === "string" ? o.title.trim().slice(0, 120) : "";
    if (!st) continue;
    const key = st.toLowerCase();
    if (seen.has(key) || key === title.toLowerCase()) continue;
    seen.add(key);
    subtasks.push({
      title: st,
      detail: typeof o.detail === "string" ? o.detail.trim().slice(0, 500) : "",
      category: CATEGORIES.includes(o.category as TaskCategory)
        ? (o.category as TaskCategory)
        : "feature",
    });
    if (subtasks.length >= 6) break;
  }
  if (subtasks.length < 2) return null;
  return { title, subtasks };
}

/**
 * IO: persist an epic plan — flip the matching open backlog row to "planned"
 * and insert its subtasks as normal `todo` rows (parent_id set, priority +
 * source inherited so the ranking keeps honoring the ask's origin). Also drops
 * a feed line so the plan is publicly visible. Returns the subtask count
 * persisted (0 = nothing done; the caller falls back to a normal build).
 */
export async function planEpic(p: Project, plan: EpicPlan): Promise<number> {
  try {
    const { supabaseAdmin } = await import("./supabase");
    if (!supabaseAdmin) return 0;

    // The parent must be a real open backlog row (todo) — the model can't
    // invent an epic out of thin air; it plans the item it was told to work.
    const { data } = await supabaseAdmin
      .from("agent_tasks")
      .select("id, priority, source")
      .eq("project_key", p.key)
      .eq("title", plan.title)
      .eq("status", "todo")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const parent = data as { id: number; priority: number; source: string } | null;
    if (!parent) return 0;

    const { error: insertErr } = await supabaseAdmin.from("agent_tasks").insert(
      plan.subtasks.map((s) => ({
        project_key: p.key,
        title: s.title,
        detail: s.detail,
        category: s.category,
        status: "todo",
        priority: parent.priority,
        source: parent.source,
        parent_id: parent.id,
      }))
    );
    if (insertErr) return 0;

    await supabaseAdmin
      .from("agent_tasks")
      .update({
        status: "planned",
        last_outcome: `split into ${plan.subtasks.length} one-cycle subtasks`,
      })
      .eq("id", parent.id);

    // Public feed line — the plan is part of the build-in-public story.
    await supabaseAdmin.from("agent_actions").insert({
      project_key: p.key,
      body: `planned epic "${plan.title}" → ${plan.subtasks.length} subtasks`,
    });
    return plan.subtasks.length;
  } catch {
    return 0;
  }
}

/**
 * IO: complete finished epics — a "planned" parent whose children ALL shipped
 * flips to shipped with a summary outcome. Cheap no-op when no planned rows
 * exist; bounded; best-effort. Returns the number of parents completed.
 */
export async function reconcileEpics(projectKey: string): Promise<number> {
  try {
    const { supabaseAdmin } = await import("./supabase");
    if (!supabaseAdmin) return 0;
    const { data: parents } = await supabaseAdmin
      .from("agent_tasks")
      .select("id, title")
      .eq("project_key", projectKey)
      .eq("status", "planned")
      .limit(10);
    const rows = (parents as { id: number; title: string }[] | null) ?? [];
    let completed = 0;
    for (const parent of rows) {
      const { data: kids } = await supabaseAdmin
        .from("agent_tasks")
        .select("status")
        .eq("parent_id", parent.id);
      const statuses = ((kids as { status: string }[] | null) ?? []).map((k) => k.status);
      if (!statuses.length || !statuses.every((s) => s === "shipped")) continue;
      const { error } = await supabaseAdmin
        .from("agent_tasks")
        .update({
          status: "shipped",
          last_outcome: `epic complete — all ${statuses.length} subtasks shipped`,
        })
        .eq("id", parent.id)
        .eq("status", "planned");
      if (!error) completed++;
    }
    return completed;
  } catch {
    return 0;
  }
}
