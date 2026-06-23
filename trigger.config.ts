import { defineConfig } from "@trigger.dev/sdk";

// Trigger.dev v4 — durable orchestration for the agent's long-running SDK-in-E2B
// sessions (the part that won't fit Vercel's 300s cron cap). The Vercel cron stays
// the cheap heartbeat/brain; when AGENT_BRAIN=sdk it enqueues one `agent-session`
// run per funded project (lib/trigger-enqueue.ts), which runs the E2B sandbox here
// with a real time budget. Project ref provided by the founder.
export default defineConfig({
  project: "proj_xcnutrkjanmeunvpjukz",
  runtime: "node",
  logLevel: "log",
  // Hard ceiling per run (the in-sandbox session has its own tighter wall-clock).
  maxDuration: 1500, // 25 min
  // An agent session is expensive + side-effecting (it can push a commit); never
  // silently retry a failed/aborted one — a fresh cycle will pick the work back up.
  retries: { enabledInDev: false, default: { maxAttempts: 1 } },
  dirs: ["./trigger"],
});
