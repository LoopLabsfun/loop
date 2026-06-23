// One-off: prove the warm "loop-agent" template runs the repo-hands GATE fast and
// green — clone → npm ci (warm cache) → tsc → vitest — WITHOUT pushing anything.
// Mirrors lib/repo-hands.buildHandsScript's quieting (logs → file, only markers +
// a failure tail on stdout) so the E2B/Jupyter kernel doesn't rate-limit output.
//
//   set -a; source .env.local; set +a
//   E2B_TEMPLATE=loop-agent NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-e2b-gate.ts
import { runInSandbox, sandboxTemplate } from "../lib/sandbox";

const REPO = process.env.VERIFY_REPO_SLUG || "LoopLabsfun/loop";

const script = [
  `set -uo pipefail`,
  `export GIT_TERMINAL_PROMPT=0`,
  `HOME="\${HOME:-/home/user}"`,
  `cd "$HOME"`,
  `rm -rf agent-work`,
  `echo "ENV: node=$(node -v) npm=$(npm -v) $(git --version)"`,
  `echo "DISK: $(df -h "$HOME" | awk 'NR==2{print $4" free of "$2}')"`,
  `T0=$(date +%s)`,
  `git clone --depth 20 "https://x-access-token:\${GITHUB_TOKEN}@github.com/${REPO}.git" agent-work >/tmp/clone.log 2>&1 || { echo CLONE_FAILED; tail -5 /tmp/clone.log; exit 0; }`,
  `cd agent-work`,
  `T1=$(date +%s); echo "CLONE_SECS=$((T1-T0))"`,
  `GATE_RESULT=ok`,
  `npm ci --no-audit --no-fund >/tmp/npm.log 2>&1 || GATE_RESULT=fail`,
  `T2=$(date +%s); echo "NPM_CI_SECS=$((T2-T1)) (fail tail follows if any)"`,
  `[ "$GATE_RESULT" = fail ] && tail -15 /tmp/npm.log`,
  `if [ "$GATE_RESULT" = ok ]; then npx tsc --noEmit >/tmp/tsc.log 2>&1 || { GATE_RESULT=fail; echo TSC_FAIL; tail -20 /tmp/tsc.log; }; fi`,
  `T3=$(date +%s); echo "TSC_SECS=$((T3-T2))"`,
  `if [ "$GATE_RESULT" = ok ]; then npx vitest run --reporter=dot >/tmp/vitest.log 2>&1 || { GATE_RESULT=fail; echo VITEST_FAIL; tail -30 /tmp/vitest.log; }; fi`,
  `T4=$(date +%s); echo "VITEST_SECS=$((T4-T3))"`,
  `echo "GATE_RESULT=$GATE_RESULT"`,
  `echo "TOTAL_SECS=$((T4-T0))"`,
].join("\n");

(async () => {
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY not set");
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set (needed to clone)");
  console.log("template:", sandboxTemplate() ?? "(default base — set E2B_TEMPLATE=loop-agent)");
  const t0 = Date.now();
  // The gate runs ~130s; without an explicit budget runInSandbox uses E2B's ~60s
  // default and times out mid `npm ci`. The runtime path passes the same budget.
  const r = await runInSandbox(
    script,
    "bash",
    { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
    { timeoutMs: 240_000 }
  );
  console.log(`\nwall: ${Math.round((Date.now() - t0) / 1000)}s, ok=${r.ok}`);
  console.log("--- stdout ---\n" + r.stdout);
  if (r.stderr.trim()) console.log("--- stderr (tail) ---\n" + r.stderr.split("\n").slice(-8).join("\n"));
})().catch((e) => {
  console.error("VERIFY FAILED:", e?.message || e);
  process.exit(1);
});
