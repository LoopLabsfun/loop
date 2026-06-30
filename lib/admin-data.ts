import "server-only";
import { supabaseAdmin } from "./supabase";
import type { Project } from "./types";
import { canAffordTick } from "./budget";
import { tickCooldownMs } from "./agent-tick-throttle";
import { effectiveEnv } from "./project-config";
import { brainMode } from "./agent-session-enqueue";
import { effectivePriority } from "./agent-backlog";
import type { TaskSource } from "./agent";

// The unified read for the founder admin console: one snapshot of everything the
// agent is doing + queued + waiting on the founder. Pulls straight from the
// agent_* tables via the service-role client (this is server-only, founder-gated
// at the route). Shaped for direct JSON return — the page renders it verbatim.

export interface AdminTaskRow {
  id: number;
  title: string;
  detail: string;
  category: string;
  status: string;
  priority: number;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface AdminSnapshot {
  configured: boolean;
  status: {
    awake: boolean;
    reason: string | null;
    paused: boolean;
    brain: "legacy" | "sdk";
    treasurySol: number;
    lastTickAt: number | null;
    cooldownMs: number;
    counts: { todo: number; building: number; shipped: number; blocked: number };
  };
  building: AdminTaskRow[];
  todo: AdminTaskRow[];
  shipped: AdminTaskRow[];
  blocked: AdminTaskRow[];
  escalations: {
    id: number;
    kind: string;
    body: string;
    status: string;
    response: string | null;
    created_at: string;
  }[];
  learnings: { category: string; insight: string; created_at: string }[];
}

export async function getAdminSnapshot(p: Project): Promise<AdminSnapshot> {
  const afford = canAffordTick(p);
  const base = {
    awake: afford.ok,
    reason: afford.ok ? null : afford.reason ?? "treasury too low",
    paused: Boolean(p.agentPaused),
    brain: brainMode(),
    treasurySol: p.treasurySol,
    // Per-project cooldown: platform env with this project's config overrides
    // on top (Lot 5), so the status reflects what the cron actually uses.
    cooldownMs: tickCooldownMs(await effectiveEnv(p.key)),
  };
  const sb = supabaseAdmin;
  if (!sb) {
    return {
      configured: false,
      status: { ...base, lastTickAt: null, counts: { todo: 0, building: 0, shipped: 0, blocked: 0 } },
      building: [], todo: [], shipped: [], blocked: [], escalations: [], learnings: [],
    };
  }
  const sel = "id,title,detail,category,status,priority,source,created_at,updated_at";
  const [tasksR, escR, learnR] = await Promise.all([
    sb.from("agent_tasks").select(sel).eq("project_key", p.key).order("updated_at", { ascending: false }).limit(150),
    sb.from("agent_escalations").select("id,kind,body,status,response,created_at").eq("project_key", p.key).eq("status", "open").order("created_at", { ascending: false }).limit(20),
    sb.from("learnings").select("category,insight,created_at").order("created_at", { ascending: false }).limit(6),
  ]);
  const rows = (tasksR.data ?? []) as AdminTaskRow[];
  const byStatus = (s: string) => rows.filter((r) => r.status === s);
  const building = byStatus("building");
  // Show `todo` in the SAME order the agent builds it — curated impact (priority +
  // source band) first, then oldest — so the backlog manager mirrors reality.
  const eff = (r: AdminTaskRow) =>
    effectivePriority({ priority: r.priority, source: r.source as TaskSource });
  const todo = byStatus("todo").sort(
    (a, b) => eff(b) - eff(a) || a.created_at.localeCompare(b.created_at)
  );
  const shippedAll = byStatus("shipped");
  const blocked = byStatus("blocked");
  const lastTickAt = rows.length
    ? Math.max(...rows.map((r) => Date.parse(r.updated_at)).filter(Number.isFinite))
    : null;
  return {
    configured: true,
    status: {
      ...base,
      lastTickAt: Number.isFinite(lastTickAt as number) ? (lastTickAt as number) : null,
      counts: { todo: todo.length, building: building.length, shipped: shippedAll.length, blocked: blocked.length },
    },
    building,
    todo,
    shipped: shippedAll.slice(0, 12),
    blocked,
    escalations: (escR.data ?? []) as AdminSnapshot["escalations"],
    learnings: (learnR.data ?? []) as AdminSnapshot["learnings"],
  };
}
