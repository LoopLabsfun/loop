import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase";
import { getAgentState, reconcileBuildingTasks } from "@/lib/agent-data";
import { brainMode, enqueueSdkSession } from "@/lib/agent-session-enqueue";
import { runAgentTick } from "@/lib/agent-runtime";
import { previewSweep, execSweep, previewClaim, execClaim } from "@/lib/treasury-actions";
import { resolveEscalation, isEscalationKind } from "@/lib/escalations";
import type { TaskCategory, TaskSource, TaskStatus } from "@/lib/agent";

// Founder admin controls — the safe interactive surface of the console. Every
// action re-checks isFounder (session cookie bound to creator_wallet).
//   pause/resume   → DB kill switch (projects.agent_paused; the cron honours it)
//   force-tick     → run/enqueue one tick NOW, bypassing the cooldown (costs $)
//   escalation     → resolve an open escalation as adopted / declined
//   reconcile      → self-heal the building queue vs the repo (landed→shipped, stalled→blocked)
//   task-status    → set one task's status (mark shipped / requeue to todo / block)
//   task-priority  → re-rank a task (backlog manager); optional source override
//   task-add       → founder adds a top-priority backlog task
//   task-remove    → delete a task from the backlog
//   treasury-sweep → drain a project's agent wallet → treasury (preview, or confirm to sign)
//   treasury-claim → collect pump.fun creator fees for the signer (preview/confirm; mainnet)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const TASK_STATUSES: TaskStatus[] = ["todo", "building", "shipped", "blocked"];
const TASK_CATEGORIES: TaskCategory[] = ["feature", "outreach", "fix", "ops"];
const TASK_SOURCES: TaskSource[] = ["founder", "holder", "agent"];

export async function POST(req: Request) {
  let body: {
    key?: string;
    action?: string;
    id?: number;
    decision?: string;
    taskId?: number;
    status?: string;
    priority?: number;
    source?: string;
    title?: string;
    detail?: string;
    category?: string;
    confirm?: boolean;
    kind?: string;
    response?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const key = body.key || "loop";
  const project = await getProject(key);
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  if (!isFounder(req, project)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "supabase not configured" }, { status: 503 });

  switch (body.action) {
    case "pause":
    case "resume": {
      const paused = body.action === "pause";
      const { error } = await sb.from("projects").update({ agent_paused: paused }).eq("key", key);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, paused });
    }
    case "force-tick": {
      if (project.agentPaused) {
        return NextResponse.json({ error: "agent is paused — resume it first" }, { status: 409 });
      }
      const state = await getAgentState(project);
      const input = { tasks: state.tasks, directives: state.directives, inbox: state.inbox };
      if (brainMode() === "sdk") {
        const r = await enqueueSdkSession(project, input);
        return NextResponse.json({ ok: true, note: r.note });
      }
      const d = await runAgentTick(project, input);
      return NextResponse.json({ ok: true, note: d.summary });
    }
    case "escalation": {
      const id = Number(body.id);
      const kind = isEscalationKind(body.kind) ? body.kind : "decision";
      const decision =
        body.decision === "adopted"
          ? "adopted"
          : body.decision === "declined"
            ? "declined"
            : body.decision === "done"
              ? "done"
              : null;
      if (!Number.isFinite(id) || !decision) {
        return NextResponse.json({ error: "bad escalation args" }, { status: 400 });
      }
      const r = await resolveEscalation(key, id, decision, kind, body.response);
      if (!r.ok) return NextResponse.json({ error: r.error ?? "resolve failed" }, { status: 400 });
      return NextResponse.json({ ok: true, id, status: r.status });
    }
    case "reconcile": {
      const r = await reconcileBuildingTasks(project);
      return NextResponse.json({ ok: true, ...r });
    }
    case "task-status": {
      const id = Number(body.taskId);
      const status = TASK_STATUSES.includes(body.status as TaskStatus)
        ? (body.status as TaskStatus)
        : null;
      if (!Number.isFinite(id) || !status) {
        return NextResponse.json({ error: "bad task-status args" }, { status: 400 });
      }
      const { error } = await sb
        .from("agent_tasks")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("project_key", key);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, taskId: id, status });
    }
    case "task-priority": {
      const id = Number(body.taskId);
      const priority = Number(body.priority);
      if (!Number.isFinite(id) || !Number.isFinite(priority)) {
        return NextResponse.json({ error: "bad task-priority args" }, { status: 400 });
      }
      const patch: { priority: number; updated_at: string; source?: TaskSource } = {
        priority: Math.max(0, Math.min(32767, Math.round(priority))),
        updated_at: new Date().toISOString(),
      };
      if (TASK_SOURCES.includes(body.source as TaskSource)) patch.source = body.source as TaskSource;
      const { error } = await sb.from("agent_tasks").update(patch).eq("id", id).eq("project_key", key);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, taskId: id, priority: patch.priority });
    }
    case "task-add": {
      const title = (body.title ?? "").trim();
      if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
      const category = TASK_CATEGORIES.includes(body.category as TaskCategory)
        ? (body.category as TaskCategory)
        : "feature";
      const priority = Number.isFinite(Number(body.priority))
        ? Math.max(0, Math.min(32767, Math.round(Number(body.priority))))
        : 100; // founder-added ⇒ top of the backlog by default
      const { error } = await sb.from("agent_tasks").insert({
        project_key: key,
        title: title.slice(0, 200),
        detail: (body.detail ?? "").slice(0, 2000),
        category,
        status: "todo",
        priority,
        source: "founder",
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    case "task-remove": {
      const id = Number(body.taskId);
      if (!Number.isFinite(id)) return NextResponse.json({ error: "bad task id" }, { status: 400 });
      const { error } = await sb.from("agent_tasks").delete().eq("id", id).eq("project_key", key);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, removed: id });
    }
    // Treasury money-moves — two-phase: preview (read-only figures) unless the
    // founder re-POSTs with confirm:true, which signs + sends. Both re-checked
    // isFounder above.
    case "treasury-sweep": {
      if (!body.confirm) {
        const preview = await previewSweep(project);
        return NextResponse.json({ ok: true, preview });
      }
      const r = await execSweep(project);
      if (!r.ok) return NextResponse.json({ error: r.error ?? "sweep failed" }, { status: 409 });
      return NextResponse.json({ ok: true, txSig: r.txSig });
    }
    case "treasury-claim": {
      if (!body.confirm) {
        return NextResponse.json({ ok: true, preview: previewClaim() });
      }
      const r = await execClaim();
      if (!r.ok) return NextResponse.json({ error: r.error ?? "claim failed" }, { status: 409 });
      return NextResponse.json({ ok: true, txSig: r.txSig, claimedSol: r.claimedSol });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
