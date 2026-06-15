import { NextResponse } from "next/server";
import { getProjects } from "@/lib/queries";
import { getAgentState } from "@/lib/agent-data";
import { runAgentTick, agentRuntimeConfigured } from "@/lib/agent-runtime";

// Scheduler entrypoint: Vercel Cron hits this on a schedule (see vercel.json) and
// it ticks the agent for each funded project — "the agent builds while the
// treasury is funded". Vercel signs cron requests with `Authorization: Bearer
// $CRON_SECRET` when CRON_SECRET is set; we require it so the endpoint isn't open.
//
// Bounded per run (Claude calls cost money + time): tick at most MAX funded
// projects. Per-project failures are isolated so one bad tick doesn't abort the rest.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PER_RUN = 3;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!agentRuntimeConfigured()) {
    return NextResponse.json(
      { error: "agent runtime not configured (set ANTHROPIC_API_KEY)" },
      { status: 503 }
    );
  }

  const projects = (await getProjects())
    .filter((p) => p.treasurySol > 0) // funded ⇒ the agent works
    .slice(0, MAX_PER_RUN);

  const results: { key: string; ok: boolean; summary?: string; error?: string }[] =
    [];
  for (const p of projects) {
    try {
      const state = await getAgentState(p);
      const decision = await runAgentTick(p, {
        tasks: state.tasks,
        directives: state.directives,
      });
      results.push({ key: p.key, ok: true, summary: decision.summary });
    } catch (e) {
      results.push({
        key: p.key,
        ok: false,
        error: e instanceof Error ? e.message : "tick failed",
      });
    }
  }

  return NextResponse.json(
    { ticked: results.length, results },
    { headers: { "Cache-Control": "no-store" } }
  );
}
