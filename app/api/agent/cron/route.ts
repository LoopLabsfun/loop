import { NextResponse } from "next/server";
import { getProjects } from "@/lib/queries";
import { getAgentState } from "@/lib/agent-data";
import { runAgentTick, agentRuntimeConfigured } from "@/lib/agent-runtime";
import { canAffordTick } from "@/lib/budget";

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

  // Budget hard-stop: only tick projects whose treasury can absorb a cycle.
  // Empty/dust treasury ⇒ the agent sleeps until buyers refill it.
  const all = await getProjects();
  const asleep = all.filter((p) => !canAffordTick(p).ok).map((p) => p.key);
  const projects = all.filter((p) => canAffordTick(p).ok).slice(0, MAX_PER_RUN);

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
      // Observability: a structured per-tick line so `vercel logs` shows WHAT the
      // agent decided and why it did/didn't commit — not just a bare 200. The
      // repo-hands push/gate note is already folded into decision.summary. No
      // secrets: this is the same public build text + decision shape.
      console.log(
        `[agent-tick] ${JSON.stringify({
          key: p.key,
          status: decision.task.status,
          task: decision.task.title,
          edits: decision.edits?.length ?? 0,
          readFiles: decision.readFiles?.length ?? 0,
          hadCommand: Boolean(decision.command),
          learning: decision.learning?.category ?? null,
          summary: decision.summary,
        })}`
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : "tick failed";
      results.push({ key: p.key, ok: false, error });
      console.error(`[agent-tick] ${JSON.stringify({ key: p.key, error })}`);
    }
  }

  // Economic loop: sweep accrued pump.fun creator fees into the treasury so the
  // agent keeps funding itself ("buyers refill it ⇒ it wakes"). ONE claim sweeps
  // all of the creator's tokens, so it runs once per cron, not per project. For
  // LOOP the pump.fun creator IS the treasury wallet, so a claim lands directly
  // in the balance the budget gate reads. This signs a REAL mainnet tx, so it's
  // opt-in: it only fires when AGENT_CLAIM_FEES=1 (the founder's explicit go).
  // A failed/empty claim is reported, never fatal.
  let feeClaim:
    | { ok: boolean; txSig?: string; skipped?: boolean; error?: string }
    | undefined;
  if (process.env.AGENT_CLAIM_FEES === "1") {
    try {
      const { collectCreatorFees } = await import("@/lib/creator-fees");
      feeClaim = await collectCreatorFees("mainnet");
    } catch (e) {
      feeClaim = { ok: false, error: e instanceof Error ? e.message : "claim failed" };
    }
  }

  return NextResponse.json(
    { ticked: results.length, asleep, results, ...(feeClaim ? { feeClaim } : {}) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
