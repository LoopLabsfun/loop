import { NextResponse } from "next/server";
import { getProject } from "@/lib/queries";
import { parseHandsOutput } from "@/lib/repo-hands";
import {
  applyDecision,
  loadSocialPlan,
  requeueTaskOnSessionError,
  type AgentDecision,
} from "@/lib/agent-runtime";
import { authorSocial } from "@/lib/agent-social";
import type { TaskCategory } from "@/lib/agent";
import { secretsMatch } from "@/lib/api-auth";

// Persist callback for a Trigger.dev agent-session run (trigger/agent-session.ts).
// The durable task runs the E2B SDK session, then POSTs the raw sandbox stdout
// here; we parse the markers (parseHandsOutput) and persist via applyDecision —
// which keeps the verifier gate honest (shipped only when PUSHED=yes) and fans the
// build update out to the task feed + socials. Gated by the shared agent secret.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORIES: TaskCategory[] = ["feature", "outreach", "fix", "ops"];

export async function POST(req: Request) {
  const secret = process.env.AGENT_TICK_SECRET;
  if (!secret || !secretsMatch(req.headers.get("x-agent-secret"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    key?: string;
    title?: string;
    detail?: string;
    category?: string;
    stdout?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { key, title, detail, category, stdout } = body;
  if (!key || !title || typeof stdout !== "string") {
    return NextResponse.json({ error: "missing key/title/stdout" }, { status: 400 });
  }

  const project = await getProject(key);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  const hands = parseHandsOutput(stdout);

  // Accrue the session's REAL billed Anthropic cost (SESSION_COST_USD ⇒
  // hands.costUsd) into the compute ledger — this is THE place SDK-brain spend
  // becomes visible (the durable Trigger.dev session bills in-sandbox; nothing
  // else records it). Recorded before the branch so an errored-but-billed session
  // still counts; failure-safe so a ledger write can never drop the persist. A
  // hard timeout that kills node before the marker prints is an unavoidable
  // under-count, not a correctness bug.
  if (hands.costUsd > 0) {
    try {
      const { getComputeLedger, saveComputeLedger } = await import("@/lib/compute-ledger-store");
      const { recordSpend } = await import("@/lib/compute-rail");
      const ledger = await getComputeLedger(project.key);
      await saveComputeLedger(project.key, recordSpend(ledger, hands.costUsd));
    } catch {
      /* ledger write failure must never block the persist */
    }
  }

  // Infra/brain failure (not a code outcome): the in-sandbox session errored,
  // timed out, or hit the Anthropic credit wall, so it never produced a usable
  // diff. Don't run the verifier gate (it would just re-hold a misleading
  // "building" card) or authorSocial (the same brain is down — the call would
  // fail anyway). Re-queue the task to "todo" so the next funded cycle retries
  // it, surface the real reason in the feed, and log it unmistakably.
  if (hands.sessionError && !hands.pushed) {
    await requeueTaskOnSessionError(project, String(title).slice(0, 120), hands.note);
    const tag = hands.creditExhausted ? "agent-credit-exhausted" : "agent-session-error";
    console.warn(`[${tag}] ${JSON.stringify({ key, title: String(title).slice(0, 120), note: hands.note })}`);
    return NextResponse.json(
      {
        key,
        pushed: false,
        sessionError: true,
        creditExhausted: hands.creditExhausted,
        requeued: true,
        note: hands.note,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const cat: TaskCategory = CATEGORIES.includes(category as TaskCategory)
    ? (category as TaskCategory)
    : "feature";
  const decision: AgentDecision = {
    summary: `sdk-hands: ${hands.note}`.slice(0, 280),
    task: {
      title: String(title).slice(0, 120),
      detail: String(detail ?? "").slice(0, 500),
      category: cat,
      // Maker self-reports "shipped"; applyDecision's verifier gate only KEEPS it
      // shipped when the check below passed (PUSHED=yes) — else held at building.
      status: "shipped",
    },
  };
  const verify = {
    checkerId: "verifier:e2b-sdk-hands",
    checks: [
      {
        kind: "test" as const,
        name: "e2b:sdk-hands",
        passed: hands.pushed,
        detail: hands.note,
      },
    ],
  };

  // Author the build-in-public voice for the SDK brain. The E2B session does the
  // engineering; it doesn't write copy — so without this an SDK-mode project never
  // authors its warm-up plan and never posts (the warm-up gate stays shut). Warm-up
  // is detected exactly as applyDecision does: no persisted plan yet ⇒ author the
  // plan this cycle (no post); once a plan exists, author own-voice posts for a real
  // ship. authorSocial is fail-safe (returns empty on silence/unconfigured/error),
  // and postingPolicy "authored-only" suppresses the templated fallback.
  try {
    const plan = await loadSocialPlan(project);
    const social = await authorSocial(
      project,
      { title: decision.task.title, detail: decision.task.detail ?? "", shipped: hands.pushed, commitSha: hands.commitSha ?? undefined },
      { warmup: !plan, plan }
    );
    if (social.socialPlan) decision.socialPlan = social.socialPlan;
    if (social.posts) decision.posts = social.posts;
  } catch {
    /* never block the persist on a social-authoring failure */
  }

  try {
    await applyDecision(project, decision, verify, {
      postingPolicy: "authored-only",
      changedFiles: hands.changedFiles,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "persist failed" },
      { status: 500 }
    );
  }

  // ROI per tick: snapshot the project's vitals onto the row that just shipped
  // (treasury/market cap/volume at ship time) — the baseline the cron's J+7
  // reconciliation scores against (lib/agent-impact). Best-effort, never blocks.
  if (hands.pushed) {
    try {
      const { recordShipSnapshot } = await import("@/lib/agent-impact");
      await recordShipSnapshot(project, decision.task.title);
    } catch {
      /* impact tracking is additive — never affects the persist */
    }
  }

  // MAKER ≠ CHECKER (opt-in AGENT_REVIEWER=1): an independent, cheap model pass
  // over the diff that actually landed. Advisory v1 — the push already happened,
  // so a REVISE never blocks; it feeds the loop instead (task outcome line, a
  // "gate" learning, an escalation when severe). Best-effort.
  if (hands.pushed) {
    try {
      const { reviewShippedWork } = await import("@/lib/agent-review");
      const review = await reviewShippedWork(
        project,
        { title: decision.task.title, detail: decision.task.detail ?? "" },
        hands.commitSha ?? undefined
      );
      if (review.ran) {
        console.log(
          `[agent-review] ${JSON.stringify({ key, verdict: review.verdict, severity: review.severity, note: review.note })}`
        );
      }
    } catch {
      /* review is advisory — never affects the persist */
    }
  }

  return NextResponse.json(
    { key, pushed: hands.pushed, gatePassed: hands.gatePassed, note: hands.note, commitSha: hands.commitSha },
    { headers: { "Cache-Control": "no-store" } }
  );
}
