// Build the custom "loop-agent" E2B sandbox template — the agent's WARM hands.
//
// Why: the agent's repo-hands gate (clone → npm ci → tsc → tests → push) runs
// inside an E2B sandbox on every commit. On E2B's bare base image that means a
// COLD `npm ci` (full network install) each cycle, which blows the ~100s/project
// cron budget (maxDuration 300s ÷ MAX_PER_RUN 3) and makes real commits flaky.
//
// This template fixes that: it bases on E2B's code-interpreter image (so the
// @e2b/code-interpreter `runCode` path keeps working — we DON'T override its
// start cmd), adds git, and pre-warms the npm cache from THIS repo's lockfile.
// At runtime the sandbox clones a fresh repo over the top; the warm ~/.npm cache
// survives and turns the per-cycle `npm ci` into a fast cache hit.
//
// Run from anywhere, with E2B_API_KEY set:
//   set -a; source .env.local; set +a
//   npx tsx scripts/e2b-template.ts
//
// On success, wire it into the runtime (locally + in Vercel) so lib/sandbox.ts
// spawns it instead of the base image:
//   E2B_TEMPLATE=loop-agent
//
// Re-run this whenever package-lock.json changes meaningfully, to refresh the
// cache (a stale cache just falls back to a partial cold install — never breaks).
import fs from "fs";
import path from "path";
import { Template, defaultBuildLogger } from "e2b";

const NAME = process.env.E2B_TEMPLATE_NAME || "loop-agent";

// E2B's `copy` resolves sources relative to THIS file's directory (scripts/) and
// forbids `..` (no escaping the build context). So stage the repo-root manifests
// into a dir INSIDE scripts/ and copy from there. Cleaned up in `finally`.
const REPO_ROOT = path.join(__dirname, "..");
const STAGE = path.join(__dirname, ".e2b-build");

(async () => {
  if (!process.env.E2B_API_KEY) {
    console.error(
      "E2B_API_KEY not set — run `set -a; source .env.local; set +a` first."
    );
    process.exit(1);
  }

  // Stage the manifests AND .npmrc. The repo pins `legacy-peer-deps=true` in
  // .npmrc (the Privy/Farcaster peer clash is harmless); without it the warm
  // `npm ci` ERESOLVE-fails and the cache never warms. The runtime gate clones
  // the whole repo (so it gets .npmrc for free) — only this isolated warm step
  // needs it copied in.
  fs.mkdirSync(STAGE, { recursive: true });
  for (const f of ["package.json", "package-lock.json", ".npmrc"]) {
    fs.copyFileSync(path.join(REPO_ROOT, f), path.join(STAGE, f));
  }

  try {
    const template = Template()
      // Keep the code-interpreter service intact (no setStartCmd) so Sandbox.runCode
      // — used by both the repo-hands gate and the plain `command` path — still works.
      .fromTemplate("code-interpreter-v1")
      // git: the gate clones the project repo and pushes the green commit to main.
      .aptInstall(["git", "ca-certificates"])
      // Warm the npm cache: install once to populate /home/user/.npm, then drop
      // node_modules — the runtime clones a fresh tree over this, so only the
      // populated cache needs to survive. Run as `user` (the sandbox's runtime
      // user) so the cache lands where the per-cycle install reads it. No `|| true`
      // swallow: if the install fails the cache is cold and the template is
      // useless, so the build should fail loudly (just re-run it).
      .setWorkdir("/home/user/.warm")
      .copy(".e2b-build/package.json", "/home/user/.warm/package.json", { user: "user" })
      .copy(".e2b-build/package-lock.json", "/home/user/.warm/package-lock.json", {
        user: "user",
      })
      // legacy-peer-deps=true — see staging note above; without it npm ci ERESOLVE-fails.
      .copy(".e2b-build/.npmrc", "/home/user/.warm/.npmrc", { user: "user" })
      .runCmd("npm ci --no-audit --no-fund && rm -rf node_modules", { user: "user" })
      .setWorkdir("/home/user");

    console.log(
      `Building E2B template "${NAME}" (code-interpreter + git + warm npm cache from package-lock.json)…`
    );
    await Template.build(template, NAME, {
      cpuCount: 2,
      memoryMB: 4096,
      onBuildLogs: defaultBuildLogger(),
    });
    console.log(`\n✅ Built E2B template "${NAME}".`);
    console.log(
      `Next: set E2B_TEMPLATE=${NAME} in .env.local and Vercel (Production) so the runtime spawns it.`
    );
  } finally {
    fs.rmSync(STAGE, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error("BUILD FAILED:", e?.message || e);
  process.exit(1);
});
