import { task } from "@trigger.dev/sdk";
import { Sandbox } from "@e2b/code-interpreter";

// ─────────────────────────────────────────────────────────────────────────────
// agent-session — the DURABLE half of the SDK brain.
//
// The Vercel cron (brain) decides WHAT to build and ships a ready-to-run bash
// script (lib/agent-sdk-hands.buildSdkHandsScript — no secrets, only $VAR refs)
// in the payload. THIS task runs that script in the warm E2B sandbox with a real
// time budget (no 300s cap): clone → npm ci → a bounded Claude Agent SDK session
// edits + tests itself → denylist on the diff → independent gate → push if green.
// Then it POSTs the raw stdout back to the app, which parses the markers and
// persists (the server-only libs live there). Secrets come from THIS worker's own
// env (set in the Trigger.dev dashboard), never from the payload.
//
// Safety carries over unchanged: the script withholds GITHUB_TOKEN from the agent
// session, denylists the diff, and gates before any push. maxAttempts:1 (config)
// means a failed run is never silently retried (no double-spend / double-push).
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentSessionPayload {
  key: string;
  title: string;
  detail: string;
  category: string;
  /** Pre-built sdk-hands bash (safe to log; references $VARS, embeds no secrets). */
  script: string;
  /** The brief handed to the in-sandbox session via $TASK_BRIEF. */
  taskBrief: string;
  model: string;
  maxTurns: number;
  wallMs: number;
  /** Execution ceiling for the sandbox run (npm ci + session + gate). */
  timeoutMs: number;
  dryRun?: boolean;
}

export const agentSession = task({
  id: "agent-session",
  maxDuration: 1500, // 25 min ceiling
  run: async (payload: AgentSessionPayload) => {
    const { key, script, taskBrief, model, maxTurns, wallMs, timeoutMs } = payload;
    const template = process.env.E2B_TEMPLATE?.trim() || undefined;
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 900_000;

    // Sandbox lifetime outlasts the run; secrets injected from the worker env.
    const createOpts = { timeoutMs: timeout + 20_000 };
    const sbx = template
      ? await Sandbox.create(template, createOpts)
      : await Sandbox.create(createOpts);

    let stdout = "";
    let stderr = "";
    let ok = false;
    try {
      const exec = await sbx.runCode(script, {
        language: "bash",
        timeoutMs: timeout,
        envs: {
          // Withheld from the agent session by the script itself (unset before it).
          GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "",
          // Powers the in-sandbox Claude Agent SDK session.
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
          TASK_BRIEF: taskBrief,
          AGENT_SDK_MODEL: model,
          AGENT_SDK_MAX_TURNS: String(maxTurns),
          AGENT_SDK_WALL_MS: String(wallMs),
        },
      });
      stdout = (exec.logs?.stdout ?? []).join("\n");
      stderr = (exec.logs?.stderr ?? []).join("\n");
      ok = !exec.error;
    } finally {
      await sbx.kill();
    }

    // Persist via the app (which has the server-only parser + Supabase writer).
    // Best-effort: a failed callback never throws here — the markers are returned
    // for observability in the Trigger.dev dashboard regardless.
    let persisted: unknown = null;
    const site = process.env.LOOP_SITE_URL?.replace(/\/$/, "");
    if (site) {
      try {
        const res = await fetch(`${site}/api/agent/session/finish`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-agent-secret": process.env.AGENT_TICK_SECRET ?? "",
          },
          body: JSON.stringify({
            key,
            title: payload.title,
            detail: payload.detail,
            category: payload.category,
            stdout,
          }),
        });
        persisted = await res.json().catch(() => ({ status: res.status }));
      } catch (e) {
        persisted = { error: e instanceof Error ? e.message : "finish callback failed" };
      }
    }

    // Surface the parseable markers (no secrets) for the dashboard.
    const markers = stdout
      .split("\n")
      .filter((l) => /^(GATE_RESULT|PUSHED|COMMIT_SHA|SESSION_\w+|NO_CHANGES|DENYLIST_HIT|CLONE_FAILED|NPM_CI_FAILED|DRY_RUN)=?/.test(l))
      .join("\n");
    return { key, ok, markers, stderrTail: stderr.split("\n").slice(-5).join("\n"), persisted };
  },
});
