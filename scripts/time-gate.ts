// READ-ONLY measurement: run the repo-hands GATE steps (clone → npm ci → tsc →
// vitest) in a real E2B sandbox and time each one, with NO commit/push. Tells us
// whether the gate can fit the cron's 300s function cap with a config bump, or
// whether we need a prebuilt E2B template with deps cached.
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/time-gate.ts
//
// Needs E2B_API_KEY + GITHUB_TOKEN. Node ≥ 20.

import { runInSandbox } from "../lib/sandbox";

const script = [
  `set -o pipefail`,
  `S=$(date +%s); T=$S`,
  `step(){ echo "[$1] $(($(date +%s)-T))s"; T=$(date +%s); }`,
  `git clone --depth 1 "https://x-access-token:$GITHUB_TOKEN@github.com/LoopLabsfun/loop.git" repo >/dev/null 2>&1 && step CLONE || { echo CLONE_FAIL; exit 1; }`,
  `cd repo`,
  `npm ci --no-audit --no-fund >/dev/null 2>&1 && step NPM_CI || { echo NPMCI_FAIL; exit 1; }`,
  `npx tsc --noEmit >/dev/null 2>&1 && step TSC || echo TSC_FAIL`,
  `npx vitest run --reporter=dot >/dev/null 2>&1 && step VITEST || echo VITEST_FAIL`,
  `echo "TOTAL $(($(date +%s)-S))s"`,
].join("\n");

async function main() {
  console.log("running gate in E2B (timeout 480s, no push)…");
  const r = await runInSandbox(
    script,
    "bash",
    { GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "" },
    { timeoutMs: 480_000 }
  );
  console.log("ok:", r.ok);
  console.log("stdout:\n" + r.stdout);
  if (r.stderr) console.log("stderr:\n" + r.stderr.slice(0, 500));
  if (r.error) console.log("error:", r.error);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
