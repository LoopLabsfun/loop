import { NextResponse } from "next/server";
import { getProjects } from "@/lib/queries";
import { getAgentState, resolveDueProposals } from "@/lib/agent-data";
import {
  runAgentTick,
  agentRuntimeConfigured,
  answerOpenChats,
} from "@/lib/agent-runtime";
import { brainMode, enqueueSdkSession } from "@/lib/agent-session-enqueue";
import { canAffordTick } from "@/lib/budget";
import { secretsMatch } from "@/lib/api-auth";

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
  if (!secret || !secretsMatch(req.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const all = await getProjects();

  // Governance auto-resolution: close every proposal that cleared the holder-
  // proportional quorum (~1/10) with a majority — adopted (for) / declined
  // (against). Runs FIRST and for EVERY project, funded or not — and crucially
  // BEFORE the brain-configured gate below: it's a free DB pass (no Claude call),
  // so "the agent decides on its own once 1/10 have voted" holds even while the
  // project sleeps or the ANTHROPIC_API_KEY isn't set. Failures swallowed inside.
  let resolvedProposals = 0;
  for (const p of all) {
    resolvedProposals += await resolveDueProposals(p);
  }

  // The brain (deciding/building) needs the API key; governance above does not.
  // Report the resolution we just did rather than failing the whole run.
  if (!agentRuntimeConfigured()) {
    return NextResponse.json(
      { resolvedProposals, brain: "unconfigured (set ANTHROPIC_API_KEY to tick)" },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Budget hard-stop: only tick projects whose treasury can absorb a cycle.
  // Empty/dust treasury ⇒ the agent sleeps until buyers refill it.
  const asleep = all.filter((p) => !canAffordTick(p).ok).map((p) => p.key);
  const projects = all.filter((p) => canAffordTick(p).ok).slice(0, MAX_PER_RUN);

  // Brain mode: "legacy" runs the whole tick inline (decide + repo-hands edits, all
  // inside this 300s function); "sdk" decides here but ENQUEUES the long-running
  // SDK-in-E2B session on Trigger.dev (no 300s cap). Default legacy — unchanged.
  const mode = brainMode();

  const results: { key: string; ok: boolean; summary?: string; error?: string }[] =
    [];
  for (const p of projects) {
    try {
      const state = await getAgentState(p);
      if (mode === "sdk") {
        // Durable path: decide + enqueue; the session + its persist happen later.
        const r = await enqueueSdkSession(p, {
          tasks: state.tasks,
          directives: state.directives,
        });
        results.push({ key: p.key, ok: true, summary: r.note });
        console.log(`[agent-sdk-enqueue] ${JSON.stringify({ key: p.key, ...r })}`);
        continue;
      }
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

  // Answer paid chat questions (agent_chat) for funded projects — the holder-
  // facing half of the agent's voice, highest boost first. Bounded + failure-safe;
  // only funded (awake) projects reply, so the "answers on its next run" promise is
  // honest. Unfunded projects' questions stay queued until the treasury wakes them.
  let chatsAnswered = 0;
  for (const p of projects) {
    chatsAnswered += await answerOpenChats(p);
  }

  // Economic loop: sweep accrued pump.fun creator fees into the treasury so the
  // agent keeps funding itself ("buyers refill it ⇒ it wakes"). ONE claim sweeps
  // all of the creator's tokens, so it runs once per cron, not per project. For
  // LOOP the pump.fun creator IS the treasury wallet, so a claim lands directly
  // in the balance the budget gate reads. This signs a REAL mainnet tx, so it's
  // opt-in: it only fires when AGENT_CLAIM_FEES=1 (the founder's explicit go).
  // A failed/empty claim is reported, never fatal.
  let feeClaim:
    | {
        ok: boolean;
        txSig?: string;
        claimedSol?: number;
        skipped?: boolean;
        error?: string;
      }
    | undefined;
  if (process.env.AGENT_CLAIM_FEES === "1") {
    try {
      const { collectCreatorFees } = await import("@/lib/creator-fees");
      feeClaim = await collectCreatorFees("mainnet");
      // Record real claimed fees as cumulative "earned" (LOOP-only phase: the
      // claim sweeps the creator==treasury wallet, so it's LOOP's revenue).
      if (feeClaim.ok && feeClaim.claimedSol && feeClaim.claimedSol > 0) {
        const { addEarnedSol } = await import("@/lib/agent-data");
        await addEarnedSol("loop", feeClaim.claimedSol);
      }
    } catch (e) {
      feeClaim = { ok: false, error: e instanceof Error ? e.message : "claim failed" };
    }
  }

  return NextResponse.json(
    {
      ticked: results.length,
      asleep,
      resolvedProposals,
      chatsAnswered,
      results,
      ...(feeClaim ? { feeClaim } : {}),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
