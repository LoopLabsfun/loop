import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// REPO-COMMITTING HANDS — the agent's REAL hands.
//
// The agent emits `edits` (full-file writes) in its decision. Inside an E2B
// sandbox the runtime clones the project repo, applies the edits, runs the REAL
// gate (install → typecheck → tests), and — only if every check is green —
// commits and pushes directly to `main`. Autonomous, with the green gate as the
// guardrail (founder's call, 2026-06-18).
//
// THIS MODULE is the pure, unit-testable core: validating the proposed edits
// against hard safety caps + a denylist (the agent must never rewrite its own
// safety/secrets/CI), and building the shell script that does the work. The E2B
// execution wrapper is env-gated and failure-safe — a failed run never aborts the
// tick, it just means no commit landed.
// ─────────────────────────────────────────────────────────────────────────────

export interface FileEdit {
  /** Repo-relative path, e.g. "lib/foo.ts". */
  path: string;
  /** Full new contents of the file (full-file write, not a diff). */
  contents: string;
}

/** Hard caps so a single autonomous commit can't rewrite the whole tree. */
export const MAX_EDIT_FILES = 12;
export const MAX_EDIT_FILE_BYTES = 64 * 1024;
export const MAX_EDIT_TOTAL_BYTES = 256 * 1024;

/**
 * Paths the agent must NEVER edit — its own safety rails, secrets, CI, infra
 * config. Pushing to main autonomously means a compromised/confused agent could
 * otherwise disable the very guardrails that contain it. Matched as a prefix or
 * exact path against the normalized (lowercased, forward-slash) repo path.
 */
export const DENY_PATH_PREFIXES = [
  ".env",
  ".github/",
  ".git/",
  "vercel.json",
  "supabase/",
  // Safety-critical libs: the agent cannot rewrite the code that gates it.
  "lib/agent-runtime.",
  "lib/agent-actions.",
  "lib/agent-actions-exec.",
  "lib/agent-wallet.",
  "lib/verifier.",
  "lib/budget.",
  "lib/signature.",
  "lib/directives.",
  "lib/console.",
  "lib/repo-hands.",
  // The SDK-hands path + its in-sandbox session runner: the agent must not be
  // able to rewrite the very hands/guardrails that execute and contain it.
  "lib/agent-sdk-hands.",
  "scripts/agent-sdk-session.",
];

export interface EditValidation {
  ok: boolean;
  reason: string;
  /** The accepted edits (only meaningful when ok). */
  edits: FileEdit[];
}

/** Pure: is a single repo-relative path safe to write? */
export function isPathAllowed(rawPath: string): boolean {
  const p = (rawPath ?? "").trim().replace(/\\/g, "/");
  if (!p) return false;
  if (p.startsWith("/")) return false; // no absolute paths
  if (p.split("/").some((seg) => seg === "..")) return false; // no traversal
  if (/^[a-zA-Z]:\//.test(p)) return false; // no windows-absolute
  const lower = p.toLowerCase();
  return !DENY_PATH_PREFIXES.some(
    (deny) => lower === deny || lower.startsWith(deny)
  );
}

/**
 * Pure: validate the agent's proposed edits against the caps + denylist. Returns
 * the normalized edits when safe, or a reason to reject the whole batch (an
 * autonomous push is all-or-nothing — one disallowed file rejects the commit).
 */
export function validateEdits(raw: unknown): EditValidation {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, reason: "no edits", edits: [] };
  }
  if (raw.length > MAX_EDIT_FILES) {
    return { ok: false, reason: `too many files (${raw.length} > ${MAX_EDIT_FILES})`, edits: [] };
  }
  const edits: FileEdit[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const e of raw) {
    if (!e || typeof e !== "object") return { ok: false, reason: "malformed edit", edits: [] };
    const path = typeof (e as FileEdit).path === "string" ? (e as FileEdit).path.trim() : "";
    const contents = typeof (e as FileEdit).contents === "string" ? (e as FileEdit).contents : "";
    if (!path) return { ok: false, reason: "edit missing path", edits: [] };
    if (!isPathAllowed(path)) {
      return { ok: false, reason: `disallowed path: ${path}`, edits: [] };
    }
    const norm = path.replace(/\\/g, "/");
    if (seen.has(norm)) return { ok: false, reason: `duplicate path: ${norm}`, edits: [] };
    seen.add(norm);
    const bytes = Buffer.byteLength(contents, "utf8");
    if (bytes > MAX_EDIT_FILE_BYTES) {
      return { ok: false, reason: `file too large: ${norm} (${bytes}B)`, edits: [] };
    }
    total += bytes;
    edits.push({ path: norm, contents });
  }
  if (total > MAX_EDIT_TOTAL_BYTES) {
    return { ok: false, reason: `edits too large in total (${total}B)`, edits: [] };
  }
  return { ok: true, reason: `accepted ${edits.length} file(s)`, edits };
}

/** Shell-safe single-quote wrap for embedding a literal in bash. */
export function shquote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface HandsScriptOpts {
  /** "owner/repo", e.g. "LoopLabsfun/loop". */
  repoSlug: string;
  branch: string;
  edits: FileEdit[];
  commitMessage: string;
  authorName: string;
  authorEmail: string;
  /**
   * Add `next build` to the gate (catches route/build breakage that typecheck +
   * unit tests miss). Off by default because it's the heaviest step — only worth
   * it on the warm template, where the cache leaves time budget. Toggled by
   * AGENT_GATE_BUILD=1 in the runtime.
   */
  fullGate?: boolean;
}

/**
 * Pure: build the bash script the E2B sandbox runs. It writes each file from a
 * base64 blob (so arbitrary contents never need shell escaping), runs the gate,
 * and pushes to `branch` ONLY when every check passed. The GitHub token is read
 * from $GITHUB_TOKEN inside the sandbox (injected as env) — it is intentionally
 * NOT embedded here, so the script string is safe to log/persist. Emits parseable
 * markers: GATE_RESULT=ok|fail, PUSHED=yes|no, COMMIT_SHA=<sha>.
 */
export function buildHandsScript(opts: HandsScriptOpts): string {
  const { repoSlug, branch, edits, commitMessage, authorName, authorEmail, fullGate } =
    opts;
  const writes = edits
    .map((e) => {
      const b64 = Buffer.from(e.contents, "utf8").toString("base64");
      const path = shquote(e.path);
      return [
        `mkdir -p "$(dirname ${path})"`,
        `printf %s ${shquote(b64)} | base64 -d > ${path}`,
      ].join("\n");
    })
    .join("\n");

  // The gate: install → typecheck → tests, and (opt-in) `next build`. Any
  // non-zero exit flips GATE_RESULT=fail and skips the push — a red tree is
  // never pushed. `next build` is gated behind fullGate because it's the
  // heaviest step; the warm E2B template (cached npm install) is what buys the
  // time budget to run it.
  //
  // Each step's (verbose) output is redirected to a log file: npm ci + vitest
  // flood stdout, which makes the E2B/Jupyter kernel hit its IOPub rate limit and
  // DROP lines — including the parseable markers (GATE_RESULT/PUSHED/COMMIT_SHA)
  // that decide whether the task ships. Keeping stdout tiny (only a short failure
  // tail + the markers) makes parsing reliable.
  const LOG = "/tmp/gate.log";
  const step = (cmd: string) =>
    `if [ "$GATE_RESULT" = "ok" ]; then ${cmd} >> ${LOG} 2>&1 || GATE_RESULT=fail; fi`;
  const gate = [
    `GATE_RESULT=ok`,
    `: > ${LOG}`,
    step(`npm ci --no-audit --no-fund`),
    step(`npx tsc --noEmit`),
    step(`npx vitest run --reporter=dot`),
    ...(fullGate ? [step(`npx next build`)] : []),
    // On failure, surface a short tail so the build log says WHY it didn't ship.
    `if [ "$GATE_RESULT" != "ok" ]; then echo "----- gate tail -----"; tail -n 25 ${LOG}; echo "---------------------"; fi`,
  ];

  // --depth 20 (not 1): a shallow-of-1 clone makes `git pull --rebase` before the
  // push fail when main advanced; 20 commits of history is enough headroom at
  // negligible clone cost.
  //
  // Clone onto the ROOT disk ($HOME → ~17G free), NOT /tmp: on the E2B image /tmp
  // is a RAM-backed tmpfs (~2G) and this repo's node_modules is ~2.3G, so `npm ci`
  // there ENOSPC-fails and the gate never goes green.
  return [
    `set -uo pipefail`,
    `export GIT_TERMINAL_PROMPT=0`,
    // `${HOME:-/home/user}`: nounset-safe (set -u would abort on a bare $HOME if
    // the kernel shell didn't export it); /home/user is the E2B sandbox user home.
    // The `\${` escape keeps JS from interpolating — bash receives the literal.
    `cd "\${HOME:-/home/user}"`,
    `rm -rf agent-work`,
    `git clone --depth 20 "https://x-access-token:\${GITHUB_TOKEN}@github.com/${repoSlug}.git" agent-work || { echo "CLONE_FAILED"; exit 0; }`,
    `cd agent-work`,
    `git checkout ${shquote(branch)} 2>/dev/null || true`,
    // Set the local git identity right after the clone (a fresh clone has none —
    // nothing sets --global in the sandbox) so EVERY git op below has an author,
    // not just the final commit. Local config, not a credential — safe this early.
    `git config user.name ${shquote(authorName)}`,
    `git config user.email ${shquote(authorEmail)}`,
    writes,
    ...gate,
    `echo "GATE_RESULT=$GATE_RESULT"`,
    `if [ "$GATE_RESULT" != "ok" ]; then echo "PUSHED=no"; exit 0; fi`,
    // Git identity was already set right after the clone, above.
    `git add -A`,
    `git diff --cached --quiet && { echo "NO_CHANGES"; echo "PUSHED=no"; exit 0; }`,
    `git commit -m ${shquote(commitMessage)} || { echo "PUSHED=no"; exit 0; }`,
    `git pull --rebase origin ${shquote(branch)} || { echo "REBASE_FAILED"; echo "PUSHED=no"; exit 0; }`,
    `git push origin ${shquote(branch)} || { echo "PUSH_FAILED"; echo "PUSHED=no"; exit 0; }`,
    `echo "PUSHED=yes"`,
    `echo "COMMIT_SHA=$(git rev-parse HEAD)"`,
  ].join("\n");
}

export interface HandsResult {
  /** A real commit landed on the branch. */
  pushed: boolean;
  /** The gate (install/typecheck/tests) passed. */
  gatePassed: boolean;
  commitSha: string | null;
  /** Short human note for the build log. */
  note: string;
  /**
   * The in-sandbox SDK session itself errored, aborted, or timed out — it never
   * got a fair attempt, so it produced no usable diff. Distinct from a clean
   * "no changes" (the maker deliberately did nothing) or a red gate (it tried,
   * the checker rejected it): an infra/brain failure, not a code outcome. The
   * legacy repo-hands path emits no SESSION_RESULT, so this stays false there.
   */
  sessionError: boolean;
  /**
   * The session error is Anthropic credit exhaustion — the agent literally can't
   * think until billing is topped up. A subset of `sessionError`, surfaced
   * separately so the finish route can flag it unmistakably instead of burying
   * it in a misleading "no file changes" note.
   */
  creditExhausted: boolean;
  /**
   * The session's real billed Anthropic cost (SESSION_COST_USD, the SDK's
   * cumulative total_cost_usd for the run). 0 when absent — the legacy repo-hands
   * path emits no cost marker, and an infra failure before the result message
   * leaves it unset. The finish route accrues this into the compute ledger.
   */
  costUsd: number;
  /**
   * The paths the tick changed (`git diff --name-only` before commit), surfaced
   * from the CHANGED_FILES marker. Lets the persist layer run the altitude
   * (busywork) check on the SDK brain's diff. Empty when absent.
   */
  changedFiles: string[];
}

/** Parse the sandbox stdout markers into a structured result. */
export function parseHandsOutput(stdout: string): HandsResult {
  const gatePassed = /GATE_RESULT=ok/.test(stdout);
  const pushed = /PUSHED=yes/.test(stdout);
  const shaMatch = stdout.match(/COMMIT_SHA=([0-9a-f]{7,40})/);
  const commitSha = shaMatch ? shaMatch[1] : null;
  // The in-sandbox session reports its own outcome (scripts/agent-sdk-session.mjs:
  // SESSION_RESULT=ok|error|aborted), and the Trigger wrapper adds
  // SESSION_RESULT=error_or_timeout when the node process is killed/crashes. Any
  // non-"ok" result with no push means the maker never produced a usable diff.
  const sessionResult = stdout.match(/SESSION_RESULT=(\S+)/)?.[1];
  const sessionNote = stdout.match(/SESSION_NOTE=(.+)/)?.[1]?.trim();
  const costMatch = stdout.match(/SESSION_COST_USD=([0-9]*\.?[0-9]+)/);
  const parsedCost = costMatch ? Number(costMatch[1]) : 0;
  const costUsd = Number.isFinite(parsedCost) && parsedCost > 0 ? parsedCost : 0;
  // CHANGED_FILES is a comma-joined `git diff --name-only` emitted by the SDK
  // hands script (the legacy path omits it → empty).
  const changedFiles = (stdout.match(/CHANGED_FILES=(.*)/)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const sessionError = !pushed && !!sessionResult && sessionResult !== "ok";
  const creditExhausted =
    sessionError && /credit balance is too low/i.test(sessionNote ?? "");
  let note: string;
  if (pushed && commitSha) note = `pushed ${commitSha.slice(0, 7)} to main (gate green)`;
  else if (/CLONE_FAILED/.test(stdout)) note = "clone failed — no changes";
  else if (creditExhausted) note = "session blocked — Anthropic credit exhausted (top up billing)";
  else if (sessionError) note = `session errored — ${sessionNote || "no usable diff produced"}`;
  else if (/NO_CHANGES/.test(stdout)) note = "no file changes to commit";
  else if (!gatePassed) note = "gate failed — not pushed (tree stays green)";
  else if (/PUSH_FAILED|REBASE_FAILED/.test(stdout)) note = "gate green but push failed (will retry next cycle)";
  else note = "no commit this cycle";
  return { pushed, gatePassed, commitSha, note, sessionError, creditExhausted, costUsd, changedFiles };
}
