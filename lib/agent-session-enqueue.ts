import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// SDK BRAIN — the durable path. The Vercel cron is the cheap heartbeat/brain: it
// decides the next action (decideNextAction) and, for a CODE task, ENQUEUES a
// long-running SDK-in-E2B session on Trigger.dev (trigger/agent-session.ts) rather
// than running it inline under the 300s cron cap. Non-code tasks (outreach/ops)
// still apply inline — they need no sandbox. Gated by AGENT_BRAIN=sdk; default
// "legacy" keeps the existing inline behaviour untouched.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from "./types";
import type { AgentTask, InboxMessage, TaskCategory } from "./agent";
import type { FeedItem } from "./console";
import {
  decideNextAction,
  buildTaskBrief,
  applyDecision,
  type AgentDecision,
} from "./agent-runtime";
import { buildSdkHandsScript } from "./agent-sdk-hands";
import { agentGitIdentity } from "./agent-git-identity";
import { effortForTask } from "./agent-effort";
import { commitMessageWithThrottle } from "./deploy-throttle";
import type { AgentSessionPayload } from "../trigger/agent-session";

export function brainMode(env: Record<string, string | undefined> = process.env): "legacy" | "sdk" {
  return env.AGENT_BRAIN === "sdk" ? "sdk" : "legacy";
}

/**
 * Build-path readiness preflight. The single most confusing failure mode is a
 * SILENT one: the agent decides + persists a code task as "building", but the
 * configured build path can't actually run it (sdk mode without TRIGGER_SECRET_KEY,
 * or legacy mode missing E2B/GITHUB_TOKEN), so the task stalls at "building"
 * forever with no signal. This pure check names the active path and lists any
 * missing prerequisites, so the cron can log a clear warning instead of stalling
 * invisibly. `canBuild` is false when a CODE task could not possibly ship.
 */
export interface BuildPathReadiness {
  mode: "legacy" | "sdk";
  canBuild: boolean;
  missing: string[];
}
export function buildPathReadiness(
  env: Record<string, string | undefined> = process.env
): BuildPathReadiness {
  const mode = brainMode(env);
  const missing: string[] = [];
  if (mode === "sdk") {
    // The cron enqueues to Trigger.dev; the durable session runs there with its
    // OWN env (set in the Trigger dashboard, not visible here). The one thing the
    // APP side must have to even enqueue is the secret key.
    if (!env.TRIGGER_SECRET_KEY) missing.push("TRIGGER_SECRET_KEY");
  } else {
    // Legacy inline repo-hands needs the agent armed + a sandbox + push creds.
    if (env.AGENT_REPO_HANDS !== "1") missing.push("AGENT_REPO_HANDS=1");
    if (!env.E2B_API_KEY) missing.push("E2B_API_KEY");
    if (!env.GITHUB_TOKEN) missing.push("GITHUB_TOKEN");
  }
  return { mode, canBuild: missing.length === 0, missing };
}

/**
 * Budgets for the DURABLE session — generous, since Trigger.dev (not the 300s
 * cron) hosts it. Defaults: ~10-min agent wall-clock, ~16-min sandbox ceiling
 * (npm ci + session + gate). Overridable via the same AGENT_SDK_* env knobs.
 */
export interface SdkSessionConfig {
  model: string;
  maxTurns: number;
  wallMs: number;
  timeoutMs: number;
}
export function sdkSessionConfig(
  env: Record<string, string | undefined> = process.env
): SdkSessionConfig {
  const num = (v: string | undefined, d: number) =>
    Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d;
  return {
    model: env.AGENT_SDK_MODEL?.trim() || "claude-sonnet-4-6",
    maxTurns: Math.min(num(env.AGENT_SDK_MAX_TURNS, 40), 100),
    wallMs: num(env.AGENT_SDK_WALL_MS, 600_000),
    timeoutMs: num(env.AGENT_SDK_TIMEOUT_MS, 1_000_000),
  };
}

const CODE_CATEGORIES: TaskCategory[] = ["feature", "fix"];

/**
 * Decide → for a code task, enqueue a durable SDK session on Trigger.dev and
 * persist it as "building" (the session's finish callback flips it to shipped);
 * for a non-code task, apply inline. Pure orchestration — failure-safe at the
 * call site (the cron isolates per-project errors).
 */
export async function enqueueSdkSession(
  p: Project,
  state: { tasks: AgentTask[]; directives: FeedItem[]; inbox?: InboxMessage[] },
  opts: { dryRun?: boolean } = {}
): Promise<{ enqueued: boolean; runId?: string; note: string }> {
  const { decision } = await decideNextAction(p, state);

  if (!CODE_CATEGORIES.includes(decision.task.category)) {
    // outreach/ops: no sandbox needed. Pass the reply allow-list so an
    // `emailReply` is mailed only to a real unanswered-inbound sender.
    const inboundParties = (state.inbox ?? [])
      .filter((m) => m.direction === "in" && !m.answered)
      .map((m) => m.party);
    // authored-only here too: SDK mode never emits templated "🛠️ building / shipped"
    // filler. Only the brain's OWN-voice post (d.posts, marketing-judged) goes out;
    // if it didn't author one, the channel stays quiet (no low-signal changelog spam).
    await applyDecision(p, decision, undefined, {
      inboundParties,
      postingPolicy: "authored-only",
    });
    return { enqueued: false, note: `non-code (${decision.task.category}) — applied inline` };
  }

  const cfg = sdkSessionConfig();
  const repoSlug = p.repo
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const prefix = decision.task.category === "fix" ? "fix" : "feat";
  const gitId = agentGitIdentity();

  // Per-task reasoning effort + turn budget: spend tokens in proportion to the
  // task's complexity (a typo fix at `low`, a multi-file feature at `high`),
  // bounded by the AGENT_SDK_MAX_TURNS ceiling. Cheap polish stops costing what a
  // hard feature costs, without capping the hard ones.
  const plan = effortForTask(decision.task);

  // Vercel build economy: batch the agent's commits into ~1 deploy per interval
  // by stamping a `[no-deploy]` trailer on commits between deploys (lib/deploy-
  // throttle + vercel.json ignoreCommand). The marker lives in the commit BODY,
  // so the public build feed (subject-only) is unaffected and every SHA still
  // lands on main. No-op unless DEPLOY_THROTTLE=1; failure-safe (errs to deploy).
  const baseCommitMessage = `${prefix}(agent): ${decision.task.title}\n\nCo-Authored-By: Loop Agent <agent@looplabs.fun>`;
  const commitMessage = await commitMessageWithThrottle(baseCommitMessage, p.repo);

  const script = buildSdkHandsScript({
    repoSlug,
    branch: "main",
    commitMessage,
    authorName: gitId.name,
    authorEmail: gitId.email,
    fullGate: process.env.AGENT_GATE_BUILD === "1",
    dryRun: opts.dryRun,
  });

  const payload: AgentSessionPayload = {
    key: p.key,
    title: decision.task.title,
    detail: decision.task.detail,
    category: decision.task.category,
    script,
    taskBrief: buildTaskBrief(decision.task),
    model: cfg.model,
    // Per-task budget (already clamped under the AGENT_SDK_MAX_TURNS ceiling).
    maxTurns: plan.maxTurns,
    effort: plan.effort,
    wallMs: cfg.wallMs,
    timeoutMs: cfg.timeoutMs,
    dryRun: opts.dryRun,
  };

  // Persist as "building" now; trigger/agent-session → /api/agent/session/finish
  // updates it to shipped (gated) once the session lands a green push.
  //
  // Social is authored at FINISH, from the REAL shipped work (authorSocial), NOT
  // here: the session hasn't run yet, so decideNextAction's premature posts/plan
  // would broadcast work-in-progress and then double-post at finish. Strip them
  // and persist authored-only (no posts ⇒ this enqueue broadcasts nothing).
  const building: AgentDecision = {
    ...decision,
    task: { ...decision.task, status: "building" },
    posts: undefined,
    socialPlan: undefined,
  };
  await applyDecision(p, building, undefined, { postingPolicy: "authored-only" });

  const { tasks } = await import("@trigger.dev/sdk");
  const handle = await tasks.trigger("agent-session", payload);
  return {
    enqueued: true,
    runId: handle.id,
    note: `enqueued agent-session ${handle.id} [${plan.effort}/${plan.maxTurns}t · ${plan.reason}] — "${decision.task.title}"`,
  };
}
