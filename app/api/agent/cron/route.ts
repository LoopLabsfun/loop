import { NextResponse } from "next/server";
import { getProjects } from "@/lib/queries";
import { getAgentState, resolveDueProposals, lastTickAt, recordTickAttempt, reconcileBuildingTasks } from "@/lib/agent-data";
import { tickCadenceMinutes, cadenceBounds } from "@/lib/agent-cadence";
import {
  runAgentTick,
  agentRuntimeConfigured,
  answerOpenChats,
} from "@/lib/agent-runtime";
import { brainMode, buildPathReadiness, enqueueSdkSession } from "@/lib/agent-session-enqueue";
import { sendDailyDigest } from "@/lib/agent-daily-digest";
import { canAffordTick } from "@/lib/budget";
import { creditBalanceUsd } from "@/lib/compute-rail";
import { getComputeLedger } from "@/lib/compute-ledger-store";
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

// How many projects to tick per cron fire. In LEGACY brain mode each tick runs a
// real E2B build INLINE, and one build (esp. the big LOOP repo) can eat most of
// the 300s function budget — so ticking 3/fire made every invocation TIME OUT at
// maxDuration and ship NOTHING. Default 1: one project ships reliably per fire,
// and fair-scheduling rotates all funded projects across consecutive fires (at the
// */10 Vercel cron that's every project ~every 40min). Raise via AGENT_MAX_PER_RUN
// once the build path is durable (SDK/Trigger.dev offloads builds off the 300s cap).
const MAX_PER_RUN = (() => {
  const n = Number(process.env.AGENT_MAX_PER_RUN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
})();

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretsMatch(req.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // KILL SWITCH — when AGENT_PAUSED=1 the cron no-ops BEFORE any brain work (no
  // Claude spend), for every caller (Vercel cron, the GitHub Actions backstop, or
  // a manual hit). Reversible: unset AGENT_PAUSED to resume. Used to stop credit
  // burn instantly without juggling secrets or the GH workflow.
  if (process.env.AGENT_PAUSED === "1") {
    return NextResponse.json(
      { paused: true },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
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
  // FAIR SCHEDULING: more funded projects than MAX_PER_RUN would otherwise starve
  // whoever sits at the back of the default (official, then newest-first) order —
  // e.g. the oldest non-official project never reaches the tick loop. Order the
  // affordable set by least-recently-ticked (never-ticked = 0 sorts first) so every
  // project round-robins in across cron fires. The cooldown below still prevents
  // re-ticking one that ran recently.
  let affordable = all.filter((p) => canAffordTick(p).ok);

  // COMPUTE-BUDGET HARD STOP (opt-in via COMPUTE_BUDGET_GATE=1): a funded project
  // ALSO sleeps once its metered Claude spend (compute_ledger.consumed_usd) has
  // caught up to the credit funded for it (credited_usd) — a real per-project $
  // cap so one project can't drain the shared Anthropic account. Mirrors the
  // treasury gate above. OFF by default: when unset, only the treasury gate
  // applies and the (extra per-project) ledger reads are skipped entirely.
  let computeAsleep: string[] = [];
  if (process.env.COMPUTE_BUDGET_GATE === "1") {
    const withCredit = await Promise.all(
      affordable.map(async (p) => ({
        p,
        ok: creditBalanceUsd(await getComputeLedger(p.key)) > 0,
      }))
    );
    computeAsleep = withCredit.filter((x) => !x.ok).map((x) => x.p.key);
    affordable = withCredit.filter((x) => x.ok).map((x) => x.p);
  }
  const tickedAt = new Map(
    await Promise.all(affordable.map(async (p) => [p.key, await lastTickAt(p.key)] as const))
  );
  const projects = [...affordable]
    .sort((a, b) => (tickedAt.get(a.key) ?? 0) - (tickedAt.get(b.key) ?? 0))
    .slice(0, MAX_PER_RUN);

  // Brain mode: "legacy" runs the whole tick inline (decide + repo-hands edits, all
  // inside this 300s function); "sdk" decides here but ENQUEUES the long-running
  // SDK-in-E2B session on Trigger.dev (no 300s cap). Default legacy — unchanged.
  const mode = brainMode();

  // Adaptive per-project cadence: instead of one flat cooldown for everyone, each
  // project's interval is derived from its own live state (backlog, congestion,
  // runway) — see lib/agent-cadence. Resolve the env bounds once per run; the
  // per-project interval is computed inside the loop from its state. AGENT_PAUSED
  // + the empty-treasury budget gate stay the instant hard stops.
  const bounds = cadenceBounds();

  // Build-path preflight: log which path is live and whether it can actually ship
  // code. A misconfig (sdk without TRIGGER_SECRET_KEY, or legacy missing E2B/token)
  // otherwise stalls every code task at "building" silently — this turns that into
  // a visible warning in `vercel logs`.
  const readiness = buildPathReadiness();
  console.log(`[agent-buildpath] ${JSON.stringify(readiness)}`);
  if (!readiness.canBuild) {
    console.warn(
      `[agent-buildpath] WARNING: ${readiness.mode} build path cannot ship code — missing ${readiness.missing.join(", ")}. Code tasks will stall at "building".`
    );
  }

  const results: { key: string; ok: boolean; summary?: string; error?: string }[] =
    [];
  for (const p of projects) {
    try {
      // Per-project kill switch (founder admin console). DB-backed counterpart to
      // the global AGENT_PAUSED env: stops THIS project's brain (no Claude spend)
      // without a redeploy. The free governance pass above still ran for it.
      if (p.agentPaused) {
        results.push({ key: p.key, ok: true, summary: "paused by founder (admin)" });
        console.log(`[agent-paused] ${JSON.stringify({ key: p.key })}`);
        continue;
      }
      // SDK-path self-heal: reconcile leaked "building" tasks against the repo
      // BEFORE reading state, so the decision sees a clean queue (landed → shipped,
      // stalled → blocked). Best-effort; the legacy brain does this internally.
      await reconcileBuildingTasks(p);
      const state = await getAgentState(p);
      // Adaptive cadence: the project paces its OWN ticks from its live state —
      // hot backlog / unanswered inbound ⇒ sooner; idle / congested / thin runway
      // ⇒ later (lib/agent-cadence). Skip the expensive brain work until this
      // project's own interval has elapsed since its last tick (lastTickAt, reused
      // from the fair-scheduling sort). The free governance pass above still runs.
      const budget = canAffordTick(p);
      const cadenceMin = tickCadenceMinutes(
        {
          treasurySol: budget.treasurySol,
          needSol: budget.needSol,
          openTodos: state.tasks.filter((t) => t.status === "todo").length,
          inFlight: state.tasks.filter(
            (t) => t.status === "building" || t.status === "blocked"
          ).length,
          unansweredInbound:
            state.inbox?.filter((m) => m.direction === "in" && !m.answered).length ?? 0,
        },
        bounds
      );
      const lastTick = tickedAt.get(p.key) ?? 0;
      const sinceMin = lastTick ? (Date.now() - lastTick) / 60_000 : Infinity;
      if (sinceMin < cadenceMin) {
        results.push({
          key: p.key,
          ok: true,
          summary: `cadence · next in ~${Math.ceil(cadenceMin - sinceMin)}min (every ~${cadenceMin}min)`,
        });
        console.log(
          `[agent-cadence] ${JSON.stringify({ key: p.key, cadenceMin, sinceMin: Math.round(sinceMin) })}`
        );
        continue;
      }
      // Commit to ticking this project: record the ATTEMPT now, BEFORE the heavy
      // E2B build. If the build then overruns the 300s function budget and the
      // function is killed (the big LOOP repo does), this marker has already
      // advanced its "last ticked" time — so the next fire picks the next-stalest
      // project instead of re-picking this one forever and starving the others.
      await recordTickAttempt(p.key);
      // Daily founder recap (once per UTC day, official projects only) — runs in
      // both brain modes since the SDK path returns early below. Self-guarding +
      // failure-safe, so it never affects the tick.
      try {
        const dg = await sendDailyDigest(p, state);
        if (dg.sent) console.log(`[agent-digest] ${JSON.stringify({ key: p.key, ...dg })}`);
      } catch (e) {
        console.error(`[agent-digest] ${JSON.stringify({ key: p.key, error: e instanceof Error ? e.message : String(e) })}`);
      }
      // Daily SOCIAL recap (once per UTC day, official + socially-ready only): an
      // authored "what shipped today" summary to Telegram + Discord. Same self-
      // guarding/idempotent posture as the founder digest; never affects the tick.
      try {
        const { sendDailyRecap } = await import("@/lib/agent-recap");
        const rc = await sendDailyRecap(p, state);
        if (rc.sent) console.log(`[agent-recap] ${JSON.stringify({ key: p.key, ...rc })}`);
      } catch (e) {
        console.error(`[agent-recap] ${JSON.stringify({ key: p.key, error: e instanceof Error ? e.message : String(e) })}`);
      }
      // Listen to Discord: pull new #general/#ideas messages into memory BEFORE
      // the brain runs, so the decision (legacy) or the SDK brief sees the freshest
      // community chatter. Failure-safe + no-op when the bot isn't configured.
      try {
        const { pollDiscordCommunity } = await import("@/lib/discord-read");
        const n = await pollDiscordCommunity(p.key);
        if (n) console.log(`[agent-discord-read] ${JSON.stringify({ key: p.key, newMessages: n })}`);
      } catch (e) {
        console.error(`[agent-discord-read] ${JSON.stringify({ key: p.key, error: e instanceof Error ? e.message : String(e) })}`);
      }
      // Listen to X: pull new replies/mentions of @looplabsfun into memory before
      // the brain runs, so the decision can ANALYZE audience responses. Failure-safe
      // + no-op when X isn't configured.
      try {
        const { pollXMentions } = await import("@/lib/x-read");
        const n = await pollXMentions(p.key);
        if (n) console.log(`[agent-x-read] ${JSON.stringify({ key: p.key, newMentions: n })}`);
      } catch (e) {
        console.error(`[agent-x-read] ${JSON.stringify({ key: p.key, error: e instanceof Error ? e.message : String(e) })}`);
      }
      if (mode === "sdk") {
        // Durable path: decide + enqueue; the session + its persist happen later.
        const r = await enqueueSdkSession(p, {
          tasks: state.tasks,
          directives: state.directives,
          inbox: state.inbox,
        });
        results.push({ key: p.key, ok: true, summary: r.note });
        console.log(`[agent-sdk-enqueue] ${JSON.stringify({ key: p.key, ...r })}`);
        continue;
      }
      const decision = await runAgentTick(p, {
        tasks: state.tasks,
        directives: state.directives,
        inbox: state.inbox,
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

  // Community Q&A: answer questions asked in Telegram + Discord, grounded in the
  // agent's real knowledge (memory) and hard-railed against hallucination
  // (lib/agent-answer). Gated by AGENT_COMMUNITY_ANSWER; per-channel failure-safe.
  let communityAnswered = 0;
  for (const p of projects) {
    try {
      // Ingest Discord HERE too (not only in the cooldown-gated brain loop above):
      // this loop runs every cron fire, so a tighter cron => fresh Discord questions
      // get answered within the cron cadence instead of waiting for the next brain
      // tick (~cooldown). Idempotent (cursor-based) — a redundant call on a non-
      // cooldown fire just finds nothing new. Mirrors Telegram's poll-then-answer.
      const { pollDiscordCommunity, answerDiscordQuestions } = await import("@/lib/discord-read");
      try {
        await pollDiscordCommunity(p.key);
      } catch (e) {
        console.error(`[agent-discord-read] ${JSON.stringify({ key: p.key, error: e instanceof Error ? e.message : String(e) })}`);
      }
      communityAnswered += await answerDiscordQuestions(p);
    } catch (e) {
      console.error(`[agent-discord-answer] ${JSON.stringify({ key: p.key, error: e instanceof Error ? e.message : String(e) })}`);
    }
    try {
      const { pollAndAnswerTelegram } = await import("@/lib/telegram-read");
      communityAnswered += await pollAndAnswerTelegram(p);
    } catch (e) {
      console.error(`[agent-telegram-answer] ${JSON.stringify({ key: p.key, error: e instanceof Error ? e.message : String(e) })}`);
    }
  }
  if (communityAnswered) console.log(`[agent-community-answer] ${JSON.stringify({ answered: communityAnswered })}`);

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
        signerPubkey?: string;
        error?: string;
      }
    | undefined;
  // Projects that share the wallet this claim swept (one collectCreatorFee sweeps
  // every token of the signer in a single lump), so we can attribute it back per
  // project. Set after a successful claim; reused by the distribution pass below.
  let feeGroupKeys: string[] = [];
  if (process.env.AGENT_CLAIM_FEES === "1") {
    try {
      const { collectCreatorFees } = await import("@/lib/creator-fees");
      feeClaim = await collectCreatorFees("mainnet");
      // Record real claimed fees as cumulative "earned". The claim sweeps EVERY
      // token of the signer wallet into one lump, so attribute it across the group
      // of projects sharing that fee-source wallet (weighted by recent volume),
      // then split each project's slice 30/65/5 into its own ledger.
      if (feeClaim.ok && feeClaim.claimedSol && feeClaim.claimedSol > 0 && feeClaim.signerPubkey) {
        const { addEarnedSol } = await import("@/lib/agent-data");
        const { splitForProject } = await import("@/lib/fees");
        const { recordSweepToLedger } = await import("@/lib/fee-ledger-store");
        const { attributeClaim, volumeWeight } = await import("@/lib/fee-attribution");

        // The group = projects whose on-chain fee-source IS this signer. Fall back
        // to LOOP alone if no row carries fee_creator_wallet yet (legacy).
        const group = all.filter((p) => p.feeCreatorWallet === feeClaim!.signerPubkey);
        const effective = group.length ? group : all.filter((p) => p.key === "loop");
        feeGroupKeys = effective.map((p) => p.key);

        const shares = attributeClaim(
          feeClaim.claimedSol,
          effective.map((p) => ({ key: p.key, weight: volumeWeight(p.volume24h) }))
        );
        for (const { key, sol } of shares) {
          if (sol <= 0) continue;
          try {
            await addEarnedSol(key, sol);
            const project = effective.find((p) => p.key === key);
            const split = splitForProject(project ?? {});
            const ledger = await recordSweepToLedger(key, sol, split);
            console.log(
              `[fee-ledger] ${JSON.stringify({
                key,
                swept: sol,
                ofLump: feeClaim.claimedSol,
                split: `${split.founderPct}/${split.agentPct}/${split.platformPct}`,
                earned: ledger.earned,
              })}`
            );
          } catch (e) {
            console.error(
              `[fee-ledger] ${JSON.stringify({ key, error: e instanceof Error ? e.message : "ledger write failed" })}`
            );
          }
        }
      }
    } catch (e) {
      feeClaim = { ok: false, error: e instanceof Error ? e.message : "claim failed" };
    }
  }

  // Physical fee distribution (closes the agent self-funding loop): send the
  // accrued AGENT (65%) + PLATFORM (5%) shares from the treasury to their wallets,
  // making the 30/65/5 split real money. HARD-GATED behind FEE_DISTRIBUTE=1 and
  // bounded to the ledger's claimable (earned − claimed); the founder share stays
  // in the treasury. Failure-safe: never affects the response.
  let feeDistribution: { sent: number; total: number; note: string } | undefined;
  if (process.env.FEE_DISTRIBUTE === "1") {
    // Distribute for every project in the swept group (those sharing this claim's
    // fee source — the only wallets the signer can disburse from). Falls back to
    // LOOP when no claim ran this tick. Each call is bounded + safety-bolted.
    const distributeKeys = feeGroupKeys.length ? feeGroupKeys : ["loop"];
    const { executeFeeDistribution } = await import("@/lib/fee-distribute-exec");
    let sent = 0;
    let total = 0;
    for (const key of distributeKeys) {
      try {
        const r = await executeFeeDistribution(key);
        sent += r.sent.length;
        total += r.sent.reduce((s, x) => s + x.sol, 0);
        if (r.sent.length || r.skipped.length) {
          console.log(
            `[fee-distribute] ${JSON.stringify({ key, sent: r.sent.length, total: r.sent.reduce((s, x) => s + x.sol, 0), note: r.note, skipped: r.skipped })}`
          );
        }
      } catch (e) {
        console.error(`[fee-distribute] ${JSON.stringify({ key, error: e instanceof Error ? e.message : "distribute failed" })}`);
      }
    }
    feeDistribution = { sent, total, note: `distributed across ${distributeKeys.length} project(s)` };
  }

  return NextResponse.json(
    {
      ticked: results.length,
      asleep,
      ...(computeAsleep.length ? { computeAsleep } : {}),
      resolvedProposals,
      chatsAnswered,
      communityAnswered,
      results,
      ...(feeClaim ? { feeClaim } : {}),
      ...(feeDistribution ? { feeDistribution } : {}),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
