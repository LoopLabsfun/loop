// One-off: prove the Claude Agent SDK in-sandbox HANDS work end-to-end — clone →
// npm ci (warm) → a bounded agentic session that edits + tests itself → denylist
// check → gate — WITHOUT pushing (dryRun). Reports turns + wall time so we can
// confirm a real session fits the cron budget before arming AGENT_SDK_HANDS.
//
//   set -a; source .env.local; set +a
//   E2B_TEMPLATE=loop-agent-sdk AGENT_SDK_MODEL=claude-sonnet-4-6 \
//     NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-sdk-session.ts
import { runInSandbox, sandboxTemplate } from "../lib/sandbox";
import { buildSdkHandsScript } from "../lib/agent-sdk-hands";

const REPO = process.env.VERIFY_REPO_SLUG || "LoopLabsfun/loop";

// A small, safe, self-contained task — enough to prove the session reads, edits,
// runs the tests, and the gate goes green. Not meant to land (dryRun = no push).
const BRIEF =
  process.env.VERIFY_TASK_BRIEF ||
  "Add a concise one-sentence top-of-file comment to lib/network.tsx describing what the file does, IF it doesn't already have one. Make no other changes. Then run `npx tsc --noEmit` and `npx vitest run` to confirm everything is still green.";

// VERIFY_BRANCH lets us prove the mechanism against the feature branch BEFORE it
// is merged to main (the cloned tree must contain agent-sdk-session.mjs + the SDK dep).
const BRANCH = process.env.VERIFY_BRANCH || "main";

const script = buildSdkHandsScript({
  repoSlug: REPO,
  branch: BRANCH,
  commitMessage: "chore(agent): verify sdk session (dry-run, never pushed)",
  authorName: "loop-agent",
  authorEmail: "agent@looplabs.fun",
  dryRun: true,
});

(async () => {
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY not set");
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set (needed to clone)");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set (the session needs it)");
  console.log("template:", sandboxTemplate() ?? "(default base — set E2B_TEMPLATE=loop-agent-sdk)");
  console.log("model:", process.env.AGENT_SDK_MODEL || "claude-sonnet-4-6", "| branch:", BRANCH);
  const t0 = Date.now();
  const r = await runInSandbox(
    script,
    "bash",
    {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN!,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      TASK_BRIEF: BRIEF,
      AGENT_SDK_MODEL: process.env.AGENT_SDK_MODEL || "claude-sonnet-4-6",
      AGENT_SDK_MAX_TURNS: process.env.AGENT_SDK_MAX_TURNS || "20",
      AGENT_SDK_WALL_MS: process.env.AGENT_SDK_WALL_MS || "180000",
    },
    // Generous here (no cron cap when run locally) so we can MEASURE real timing.
    { timeoutMs: Number(process.env.VERIFY_TIMEOUT_MS) || 480_000 }
  );
  console.log(`\nwall: ${Math.round((Date.now() - t0) / 1000)}s, ok=${r.ok}`);
  console.log("--- stdout ---\n" + r.stdout);
  if (r.stderr.trim()) console.log("--- stderr (tail) ---\n" + r.stderr.split("\n").slice(-10).join("\n"));
})().catch((e) => {
  console.error("VERIFY FAILED:", e?.message || e);
  process.exit(1);
});
