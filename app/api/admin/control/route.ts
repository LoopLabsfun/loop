import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { isFounder } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase";
import { getAgentState } from "@/lib/agent-data";
import { brainMode, enqueueSdkSession } from "@/lib/agent-session-enqueue";
import { runAgentTick } from "@/lib/agent-runtime";

// Founder admin controls — the safe interactive surface of the console. Every
// action re-checks isFounder (session cookie bound to creator_wallet).
//   pause/resume   → DB kill switch (projects.agent_paused; the cron honours it)
//   force-tick     → run/enqueue one tick NOW, bypassing the cooldown (costs $)
//   escalation     → resolve an open escalation as adopted / declined
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { key?: string; action?: string; id?: number; decision?: string };
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
      const decision =
        body.decision === "adopted" ? "adopted" : body.decision === "declined" ? "declined" : null;
      if (!Number.isFinite(id) || !decision) {
        return NextResponse.json({ error: "bad escalation args" }, { status: 400 });
      }
      const { error } = await sb
        .from("agent_escalations")
        .update({ status: decision, resolved_at: new Date().toISOString() })
        .eq("id", id)
        .eq("project_key", key)
        .eq("status", "open");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, id, decision });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
