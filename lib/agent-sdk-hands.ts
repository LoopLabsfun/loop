import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// AGENT SDK HANDS — the agent's hands as a real Claude-Code-style loop.
//
// Where `repo-hands` applies pre-computed full-file `edits` the Vercel brain
// emitted, THIS path delegates the actual engineering to a bounded Claude Agent
// SDK session running INSIDE the E2B sandbox (scripts/agent-sdk-session.mjs): it
// reads/greps/edits and runs the tests ITSELF, iterating like Claude Code, then
// we gate + push. Env-gated (AGENT_SDK_HANDS) and failure-safe — a bad/aborted
// session just produces a red or empty diff, which never pushes.
//
// THIS module is the pure, unit-testable core: building the bash the sandbox runs.
// Hard safety properties, asserted by the tests:
//   1. the SESSION runs with NO git credential in its env (the token is captured
//      then `unset` before the session, re-used only for clone + push) — a
//      confused/compromised session cannot push or exfiltrate via git;
//   2. the resulting diff is checked against the SAME denylist as repo-hands
//      (the agent can write any path; we refuse to commit if it touched a guarded
//      one) BEFORE the gate;
//   3. the INDEPENDENT gate (tsc + tests, optional build) still gates the push —
//      the session is the maker, our gate is the checker (A1).
// Emits the same markers as repo-hands so parseHandsOutput is reused verbatim.
// ─────────────────────────────────────────────────────────────────────────────

import { DENY_PATH_PREFIXES, shquote } from "./repo-hands";

export interface SdkHandsScriptOpts {
  /** "owner/repo", e.g. "LoopLabsfun/loop". */
  repoSlug: string;
  branch: string;
  commitMessage: string;
  authorName: string;
  authorEmail: string;
  /** Add `next build` to the gate (heavier; needs the warm template's headroom). */
  fullGate?: boolean;
  /**
   * Stop after the gate WITHOUT committing/pushing — for the verify script and a
   * prod dry-run (watch the agent edit + gate green before arming the real push).
   */
  dryRun?: boolean;
}

/** Escape a literal string for safe embedding inside a POSIX ERE (`/` is not
 *  special in ERE, so it's left as-is — grep matches it literally). */
function escapeEre(s: string): string {
  return s.replace(/[.[\]()*+?^${}|\\]/g, "\\$&");
}

/**
 * Build the deny-regex from the SHARED denylist (single source of truth with
 * repo-hands' validateEdits) so the post-session diff is rejected if it touched
 * any guarded path. Anchored at the start; matched case-insensitively.
 */
export function denyDiffRegex(prefixes: readonly string[] = DENY_PATH_PREFIXES): string {
  return `^(${prefixes.map(escapeEre).join("|")})`;
}

/**
 * Pure: the bash the E2B sandbox runs for an SDK-hands cycle. The task brief,
 * model and budgets are injected as ENV (TASK_BRIEF / AGENT_SDK_*) by the runtime
 * — never embedded here, so the script string is safe to log/persist and free of
 * injection hazards. GITHUB_TOKEN + ANTHROPIC_API_KEY are likewise sandbox env;
 * the token is withheld from the session (see property 1 above).
 */
export function buildSdkHandsScript(opts: SdkHandsScriptOpts): string {
  const { repoSlug, branch, commitMessage, authorName, authorEmail, fullGate, dryRun } =
    opts;
  const LOG = "/tmp/sdk-gate.log";
  const DENY = denyDiffRegex();
  const step = (cmd: string) =>
    `if [ "$GATE_RESULT" = "ok" ]; then ${cmd} >> ${LOG} 2>&1 || GATE_RESULT=fail; fi`;

  return [
    `set -uo pipefail`,
    `export GIT_TERMINAL_PROMPT=0`,
    // Per-phase timing markers (stdout, no secrets) so every run's bottleneck is
    // visible — clone vs npm ci vs the agentic session vs the gate. Parsed nowhere
    // critical; purely observability (the timeouts were invisible without this).
    `SDK_T0=$(date +%s)`,
    // Capture the GitHub token, then REMOVE it from the environment so the agent
    // session (spawned below) never sees it — re-used only for clone + push.
    `GH="\${GITHUB_TOKEN:-}"`,
    `unset GITHUB_TOKEN`,
    // Clone onto the ROOT disk ($HOME), not the /tmp tmpfs (ENOSPC) — same as repo-hands.
    `cd "\${HOME:-/home/user}"`,
    `rm -rf agent-work`,
    `git clone --depth 20 --branch ${shquote(branch)} "https://x-access-token:\${GH}@github.com/${repoSlug}.git" agent-work || { echo "CLONE_FAILED"; echo "PUSHED=no"; exit 0; }`,
    `cd agent-work`,
    `echo "PHASE=clone t=$(($(date +%s)-SDK_T0))s"`,
    // Set the local git identity NOW, before the session runs — not just before
    // the final commit. A fresh clone in the sandbox has NO git identity (nothing
    // sets --global), and Claude Code's internal git checkpointing tries to commit
    // during the session → "tell me who you are" (git config --global user.email …).
    // Local config (not --global), not a credential, so safe to set this early.
    `git config user.name ${shquote(authorName)}`,
    `git config user.email ${shquote(authorEmail)}`,
    `: > ${LOG}`,
    // Install deps so the SESSION can run the tests itself (warm cache).
    `npm ci --no-audit --no-fund >> ${LOG} 2>&1 || { echo "NPM_CI_FAILED"; echo "GATE_RESULT=fail"; echo "PUSHED=no"; tail -n 20 ${LOG}; exit 0; }`,
    `echo "PHASE=npm_ci t=$(($(date +%s)-SDK_T0))s"`,
    // ── The agentic session (maker). No GITHUB_TOKEN in its env. Bounded by the
    //    runner's maxTurns + wall-clock; its own test runs are advisory. ──
    // Hard wall backstop: the session's own JS AbortController aborts the async
    // iterator but does NOT kill the spawned Claude Code subprocess, so a runaway
    // session can overrun its wall by minutes and hang the whole sandbox to the
    // ceiling (observed: ~600s on a 300s wall). `timeout` kills the process GROUP
    // at wall + 60s grace (SIGTERM, then SIGKILL 10s later), bounding the run
    // deterministically to clone + npm ci + wall + gate. Coreutils `timeout` is
    // standard in the sandbox image.
    `timeout -k 10 "$(( \${AGENT_SDK_WALL_MS:-150000} / 1000 + 60 ))s" node scripts/agent-sdk-session.mjs || echo "SESSION_RESULT=error_or_timeout"`,
    `echo "PHASE=session t=$(($(date +%s)-SDK_T0))s"`,
    // Did it change anything?
    `CHANGED="$(git -C "$PWD" diff --name-only)"`,
    `if [ -z "$CHANGED" ]; then echo "NO_CHANGES"; echo "PUSHED=no"; exit 0; fi`,
    // Denylist on the diff (the agent could write any path).
    `if printf '%s\\n' "$CHANGED" | grep -qiE ${shquote(DENY)}; then echo "DENYLIST_HIT"; echo "GATE_RESULT=fail"; echo "PUSHED=no"; printf '%s\\n' "$CHANGED" | grep -iE ${shquote(DENY)}; exit 0; fi`,
    // ── The INDEPENDENT gate (checker). A red tree never pushes. ──
    `GATE_RESULT=ok`,
    step(`npx tsc --noEmit`),
    step(`npx vitest run --reporter=dot`),
    ...(fullGate ? [step(`npx next build`)] : []),
    `if [ "$GATE_RESULT" != "ok" ]; then echo "----- gate tail -----"; tail -n 25 ${LOG}; echo "---------------------"; fi`,
    `echo "GATE_RESULT=$GATE_RESULT"`,
    `echo "PHASE=gate t=$(($(date +%s)-SDK_T0))s"`,
    // dryRun OMITS the commit/push tail entirely (defense in depth: a dry-run
    // script literally cannot push). Otherwise commit + push if green.
    ...(dryRun
      ? [`echo "DRY_RUN=1"; echo "PUSHED=no"`]
      : [
          `if [ "$GATE_RESULT" != "ok" ]; then echo "PUSHED=no"; exit 0; fi`,
          // ── Commit + push (token re-introduced only here). Git identity was
          //    already set right after the clone, above. ──
          `git add -A`,
          `git diff --cached --quiet && { echo "NO_CHANGES"; echo "PUSHED=no"; exit 0; }`,
          `git commit -m ${shquote(commitMessage)} || { echo "PUSHED=no"; exit 0; }`,
          `git pull --rebase "https://x-access-token:\${GH}@github.com/${repoSlug}.git" ${shquote(branch)} || { echo "REBASE_FAILED"; echo "PUSHED=no"; exit 0; }`,
          `git push "https://x-access-token:\${GH}@github.com/${repoSlug}.git" ${shquote(branch)} || { echo "PUSH_FAILED"; echo "PUSHED=no"; exit 0; }`,
          `echo "PUSHED=yes"`,
          `echo "COMMIT_SHA=$(git rev-parse HEAD)"`,
        ]),
  ].join("\n");
}
