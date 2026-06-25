// Headless Claude Agent SDK session — the agent's REAL hands, Claude-Code-style.
//
// Runs INSIDE the E2B sandbox, in the freshly-cloned project repo (cwd). Given a
// task brief (env TASK_BRIEF), it autonomously reads/greps/edits files and runs
// the tests ITSELF, iterating until it's satisfied — the loop Claude Code runs,
// not a one-shot edit. It edits files in place; the wrapping bash script
// (lib/agent-sdk-hands.ts) then enforces the denylist on the diff and runs the
// INDEPENDENT gate before any push — so this session is the maker, never the
// checker (A1), and it has NO git credentials in its env (the wrapper withholds
// GITHUB_TOKEN), so it can't push or exfiltrate.
//
// Bounded by maxTurns + a hard wall-clock abort so a runaway session can't blow
// the sandbox/cron budget. Prints only short markers (no secrets, no file bodies).
//
// Env in:  TASK_BRIEF (required), AGENT_SDK_MODEL, AGENT_SDK_MAX_TURNS,
//          AGENT_SDK_WALL_MS, ANTHROPIC_API_KEY (required by the SDK).
// Stdout:  SESSION_TURNS=<n>, SESSION_RESULT=ok|error|aborted, SESSION_NOTE=<…>.
import { query } from "@anthropic-ai/claude-agent-sdk";

// The E2B sandbox runs commands as root, but Claude Code refuses
// `--dangerously-skip-permissions` (which bypassPermissions maps to) under root
// "for security reasons" → the subprocess exits 1. IS_SANDBOX=1 is the documented
// escape hatch that tells Claude Code it's in an isolated sandbox, permitting it.
// HOME must also be set so Claude Code can create its config dir (the E2B kernel
// shell leaves HOME unset). Both are safe here: the sandbox is ephemeral + the
// isolation boundary, and the git token is withheld from this process's env.
process.env.IS_SANDBOX = "1";
process.env.HOME ||= "/home/user";

// The brief is passed base64-encoded (TASK_BRIEF_B64) because E2B's runCode drops
// multiline env values — the raw multiline TASK_BRIEF arrived empty and every SDK
// tick no-op'd. Decode the b64 first; fall back to the raw var for back-compat.
const briefB64 = process.env.TASK_BRIEF_B64?.trim();
const brief = (
  briefB64
    ? Buffer.from(briefB64, "base64").toString("utf8")
    : process.env.TASK_BRIEF || ""
).trim();
if (!brief) {
  console.log("SESSION_RESULT=error");
  console.log("SESSION_NOTE=no TASK_BRIEF");
  process.exit(0); // never hard-fail: the wrapper reads markers, an empty diff => no push
}

const model = process.env.AGENT_SDK_MODEL?.trim() || "claude-sonnet-4-6";
const maxTurns = Math.max(1, Math.min(Number(process.env.AGENT_SDK_MAX_TURNS) || 24, 60));
const wallMs = Math.max(20_000, Number(process.env.AGENT_SDK_WALL_MS) || 150_000);

// Hard wall-clock kill: abort the session so the wrapper still gets to gate
// whatever was written (an incomplete edit just fails the gate → no push).
const abort = new AbortController();
const killer = setTimeout(() => abort.abort(), wallMs);

const guidance = [
  "You are the autonomous engineer for this repository, working exactly like Claude Code.",
  "Make the SMALLEST real, correct change that satisfies the task and KEEPS THE BUILD GREEN.",
  "Workflow: read the relevant files first, make the edit, then verify it YOURSELF by running",
  "ONLY the test file(s) covering what you changed (e.g. `npx vitest run path/to/the.test.ts`)",
  "plus `npx tsc --noEmit`; if they fail, fix and re-run. Do NOT run the whole `npx vitest run`",
  "suite on each iteration — it has 600+ tests and the full suite runs independently as the gate",
  "after you stop, so targeted runs keep you fast without losing the safety net.",
  "Match the surrounding code style and existing patterns. Do not add dependencies unless",
  "strictly necessary. Never touch CI, secrets, infra config, or the agent's own runtime/",
  "safety files (.github, .env*, vercel.json, supabase/, lib/agent-runtime*, lib/repo-hands*,",
  "lib/agent-sdk-hands*, lib/budget*, lib/verifier*) — edits there are rejected and waste the run.",
  "When the change is done and the tests pass, STOP. Do not commit or push — that is handled for you.",
].join(" ");

let turns = 0;
let result = "ok";
let note = "";
let costUsd = 0;
try {
  const q = query({
    prompt: brief,
    options: {
      cwd: process.cwd(),
      model,
      maxTurns,
      // Fully headless: no human to approve tool use. We constrain the blast
      // radius with allowedTools + the post-session denylist + the green gate.
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      allowedTools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "TodoWrite"],
      appendSystemPrompt: guidance,
      abortController: abort,
      executable: "node",
      stderr: () => {}, // swallow harness chatter; we only emit our own markers
    },
  });
  for await (const msg of q) {
    if (msg?.type === "assistant") turns += 1;
    if (msg?.type === "result") {
      // Terminal SDK result message: capture subtype + the session's real billed
      // cost (total_cost_usd is cumulative for the whole session). Emitting it lets
      // the runtime accrue actual Anthropic spend into the compute ledger.
      note = String(msg.subtype ?? "").slice(0, 80);
      const c = Number(msg.total_cost_usd);
      if (Number.isFinite(c) && c >= 0) costUsd = c;
    }
  }
} catch (e) {
  result = abort.signal.aborted ? "aborted" : "error";
  note = (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 120);
} finally {
  clearTimeout(killer);
}

console.log(`SESSION_TURNS=${turns}`);
console.log(`SESSION_RESULT=${result}`);
if (note) console.log(`SESSION_NOTE=${note}`);
if (costUsd > 0) console.log(`SESSION_COST_USD=${costUsd.toFixed(6)}`);
