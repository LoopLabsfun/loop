import "server-only";

import type { AgentTask, TaskCategory, TaskStatus } from "./agent";
import { defaultMandate, type AgentMandate, type FeedItem } from "./console";
import type { Project } from "./types";
import { supabaseAdmin } from "./supabase";
import { gateTaskStatus } from "./verifier";
import type { SandboxLanguage } from "./sandbox";
import { formatLearningsForPrompt, type Learning } from "./learnings";
import { getTopLearnings } from "./agent-data";

// The real per-project agent "brain". Given the project's mandate (its launch
// prompt) plus the latest steering directives and current task state, it asks
// Claude for the next concrete build action + a one-line build update, then
// persists them to agent_tasks / agent_posts — which the Agent Operator UI
// already reads. This is the thinking half of the runtime; code execution in a
// sandbox (E2B) is a later layer.
//
// Env-gated like the launchpad providers: no ANTHROPIC_API_KEY ⇒ no-op-failing,
// so the simulated UI keeps working until the runtime is switched on. Server-
// only; the key never reaches the browser. Heavy SDK is imported dynamically.

const AGENT_MODEL = "claude-opus-4-8";
const CATEGORIES: TaskCategory[] = ["feature", "outreach", "fix", "ops"];
const STATUSES: TaskStatus[] = ["todo", "building", "shipped", "blocked"];
const SANDBOX_LANGS: SandboxLanguage[] = ["python", "javascript", "bash"];

export interface AgentDecision {
  /** One-line public build update (→ agent_posts). */
  summary: string;
  /** The task the agent is advancing this tick (→ agent_tasks). */
  task: {
    title: string;
    detail: string;
    category: TaskCategory;
    status: TaskStatus;
  };
  /** Optional real code the agent runs in the E2B sandbox this tick. */
  command?: { language: SandboxLanguage; code: string };
}

/** Structured-output schema constraining Claude's decision. */
export const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    task: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        detail: { type: "string" },
        category: { type: "string", enum: CATEGORIES },
        status: { type: "string", enum: STATUSES },
      },
      required: ["title", "detail", "category", "status"],
    },
    command: {
      type: "object",
      additionalProperties: false,
      properties: {
        language: { type: "string", enum: SANDBOX_LANGS },
        code: { type: "string" },
      },
      required: ["language", "code"],
    },
  },
  required: ["summary", "task"],
} as const;

export function agentRuntimeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Pure: the agent's persona built from its STANDING mandate — restated in full
 * every cycle (mission + guardrails) to mitigate goal drift. Defaults to the
 * project's derived mandate; pass a (persisted) override to reload it each tick.
 */
export function buildSystemPrompt(
  p: Project,
  mandate: AgentMandate = defaultMandate(p)
): string {
  return [
    `You are the autonomous AI engineer that builds and grows the project "${p.name}" (${p.ticker}).`,
    `Your standing mandate — reread it every cycle and do NOT drift from it: ${mandate.mission}`,
    `Hard guardrails you must never violate: ${mandate.guardrails.join("; ")}.`,
    `You are funded by the project's on-chain treasury and accountable to its token holders.`,
    `Each tick you pick ONE concrete next action that moves the project forward, do it, and report it honestly.`,
    `Prefer shipping small, real increments (features, fixes, outreach, ops) over vague plans.`,
    `You may optionally include a "command" (python/javascript/bash) to run real code in a sandbox this tick — use it to actually do work, not to fake it.`,
    `Never invent fake metrics or claim work you didn't do.`,
  ].join(" ");
}

/**
 * Reload the canonical mandate each cycle: a founder-editable persisted override
 * (latest `kind="mandate"` directive) if present, else the project's default.
 * Fails safe to the default when there's no DB / no override.
 */
export async function loadMandate(p: Project): Promise<AgentMandate> {
  const base = defaultMandate(p);
  try {
    const { supabase } = await import("./supabase");
    if (!supabase) return base;
    const { data } = await supabase
      .from("directives")
      .select("text")
      .eq("project_key", p.key)
      .eq("kind", "mandate")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const mission = (data as { text?: string } | null)?.text?.trim();
    return mission ? { ...base, mission } : base;
  } catch {
    return base;
  }
}

/** Pure: the current-state turn — tasks, steering directives, shared learnings. */
export function buildUserPrompt(
  tasks: AgentTask[],
  directives: FeedItem[],
  learnings: Learning[] = []
): string {
  const taskLines = tasks.length
    ? tasks
        .slice(0, 12)
        .map((t) => `- [${t.status}] (${t.category}) ${t.title}`)
        .join("\n")
    : "(no tasks yet — you are just starting)";
  const directiveLines = directives.length
    ? directives
        .slice(0, 8)
        .map((d) => `- (${d.kind}${d.by ? `/${d.by}` : ""}) ${d.text}`)
        .join("\n")
    : "(no founder/holder directives yet)";
  return [
    "Current tasks:",
    taskLines,
    "",
    "Steering directives from the founder and holders (honor these):",
    directiveLines,
    "",
    "Shared learnings from across the Loop network (apply if relevant):",
    formatLearningsForPrompt(learnings),
    "",
    "Decide the single next action to take now. Return a one-line build update",
    "(`summary`) and the task you are advancing (`task`), with an honest status.",
  ].join("\n");
}

/** Pure: clamp + normalise a parsed decision into the typed shape. */
export function coerceDecision(raw: unknown): AgentDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const t = (r.task ?? {}) as Record<string, unknown>;
  const summary = typeof r.summary === "string" ? r.summary.trim() : "";
  const title = typeof t.title === "string" ? t.title.trim() : "";
  const detail = typeof t.detail === "string" ? t.detail.trim() : "";
  if (!summary || !title) return null;
  const category = CATEGORIES.includes(t.category as TaskCategory)
    ? (t.category as TaskCategory)
    : "feature";
  const status = STATUSES.includes(t.status as TaskStatus)
    ? (t.status as TaskStatus)
    : "building";

  const c = (r.command ?? null) as Record<string, unknown> | null;
  let command: AgentDecision["command"];
  if (c && typeof c.code === "string" && c.code.trim()) {
    const language = SANDBOX_LANGS.includes(c.language as SandboxLanguage)
      ? (c.language as SandboxLanguage)
      : "python";
    command = { language, code: c.code };
  }

  return {
    summary: summary.slice(0, 280),
    task: {
      title: title.slice(0, 120),
      detail: detail.slice(0, 500),
      category,
      status,
    },
    ...(command ? { command } : {}),
  };
}

/** Ask Claude for the next action. Throws if the runtime isn't configured. */
export async function decideNextAction(
  p: Project,
  state: { tasks: AgentTask[]; directives: FeedItem[] }
): Promise<AgentDecision> {
  if (!agentRuntimeConfigured()) {
    throw new Error("Agent runtime selected but ANTHROPIC_API_KEY is not set.");
  }
  // Reread the standing mandate every cycle (anti-drift).
  const mandate = await loadMandate(p);
  // Pull the network's shared learnings (A5) into the turn context.
  const learnings = await getTopLearnings(6);
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  // `output_config` (structured outputs) may be ahead of the installed SDK
  // types; call loosely and read the content blocks off the result.
  const params = {
    model: AGENT_MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: DECISION_SCHEMA } },
    system: buildSystemPrompt(p, mandate),
    messages: [
      {
        role: "user",
        content: buildUserPrompt(state.tasks, state.directives, learnings),
      },
    ],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = (await (client.messages.create as any)(params)) as {
    content: Array<{ type: string; text?: string }>;
  };

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Agent returned non-JSON output.");
  }
  const decision = coerceDecision(parsed);
  if (!decision) throw new Error("Agent decision failed validation.");
  return decision;
}

/** Persist a decision: a public build update + the advanced task. */
export async function applyDecision(
  p: Project,
  d: AgentDecision
): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error("Agent runtime requires SUPABASE_SERVICE_ROLE_KEY to persist.");
  }

  // Verifier gate (A1): the maker can't ship its own work. Until an independent
  // checker records a passing objective gate, a self-declared "shipped" is
  // downgraded to "building" — the Ralph Wiggum guardrail. The block reason is
  // surfaced in the public build update for transparency.
  const gated = gateTaskStatus({
    project: p,
    status: d.task.status,
    makerId: `agent:${p.key}`,
  });
  const summary = gated.note ? `${d.summary} [${gated.note}]`.slice(0, 280) : d.summary;

  await supabaseAdmin.from("agent_posts").insert({
    project_key: p.key,
    platform: "telegram",
    body: summary,
  });
  await supabaseAdmin.from("agent_tasks").insert({
    project_key: p.key,
    title: d.task.title,
    detail: d.task.detail,
    category: d.task.category,
    status: gated.status,
  });

  // Read-only Telegram build update — only when something actually shipped (so
  // the bot reports news, not every tick). Phase 1: a single bot + chat via env
  // (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID); per-project chats come with a
  // telegram_chat_id column later. No-ops unless both are set, and a send
  // failure must never abort the agent cycle.
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (gated.status === "shipped" && chatId && process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const { sendBuildUpdate } = await import("./telegram-send");
      const shipped: AgentTask = {
        id: "",
        title: d.task.title,
        detail: d.task.detail,
        category: d.task.category,
        status: "shipped",
        at: "now",
      };
      await sendBuildUpdate(chatId, p, { shipped: [shipped] });
    } catch {
      /* telegram unavailable/failed — never abort the cycle */
    }
  }
}

/** One full agent tick for a project: decide → persist. Returns the decision. */
export async function runAgentTick(
  p: Project,
  state: { tasks: AgentTask[]; directives: FeedItem[] }
): Promise<AgentDecision> {
  const decision = await decideNextAction(p, state);

  // Hands: if the agent asked to run code and the sandbox is configured, execute
  // it and fold the result into the build update. A sandbox failure must not
  // abort the tick (the plan still stands).
  if (decision.command && process.env.E2B_API_KEY) {
    try {
      const { runInSandbox, summarizeSandbox } = await import("./sandbox");
      const result = await runInSandbox(
        decision.command.code,
        decision.command.language
      );
      decision.summary = `${decision.summary} — ${decision.command.language}: ${summarizeSandbox(result)}`.slice(
        0,
        280
      );
    } catch {
      /* sandbox unavailable/failed — keep the planned summary */
    }
  }

  await applyDecision(p, decision);
  return decision;
}
