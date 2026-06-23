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
import type { AgentTask, TaskCategory } from "./agent";
import type { FeedItem } from "./console";
import {
  decideNextAction,
  buildTaskBrief,
  applyDecision,
  type AgentDecision,
} from "./agent-runtime";
import { buildSdkHandsScript } from "./agent-sdk-hands";
import { agentGitIdentity } from "./agent-git-identity";
import type { AgentSessionPayload } from "../trigger/agent-session";

export function brainMode(env: Record<string, string | undefined> = process.env): "legacy" | "sdk" {
  return env.AGENT_BRAIN === "sdk" ? "sdk" : "legacy";
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
  state: { tasks: AgentTask[]; directives: FeedItem[] },
  opts: { dryRun?: boolean } = {}
): Promise<{ enqueued: boolean; runId?: string; note: string }> {
  const decision = await decideNextAction(p, state);

  if (!CODE_CATEGORIES.includes(decision.task.category)) {
    await applyDecision(p, decision); // outreach/ops: no sandbox needed
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
  const script = buildSdkHandsScript({
    repoSlug,
    branch: "main",
    commitMessage: `${prefix}(agent): ${decision.task.title}\n\nCo-Authored-By: Loop Agent <agent@looplabs.fun>`,
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
    maxTurns: cfg.maxTurns,
    wallMs: cfg.wallMs,
    timeoutMs: cfg.timeoutMs,
    dryRun: opts.dryRun,
  };

  // Persist as "building" now; trigger/agent-session → /api/agent/session/finish
  // updates it to shipped (gated) once the session lands a green push.
  const building: AgentDecision = {
    ...decision,
    task: { ...decision.task, status: "building" },
  };
  await applyDecision(p, building);

  const { tasks } = await import("@trigger.dev/sdk");
  const handle = await tasks.trigger("agent-session", payload);
  return {
    enqueued: true,
    runId: handle.id,
    note: `enqueued agent-session ${handle.id} — "${decision.task.title}"`,
  };
}
