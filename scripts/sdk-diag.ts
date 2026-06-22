// Diagnostic: prove the Claude Agent SDK `query()` runs headless inside the E2B
// sandbox (the subprocess used to exit 1 under root — fixed by IS_SANDBOX=1 + an
// explicit HOME, commit 49ac4d5). Clones main, npm ci's, then runs a 1-turn probe
// both as root (IS_SANDBOX=1) and as the non-root `user`, surfacing the Claude
// Code stderr the runner normally swallows. Read-only — it never edits or pushes.
//
//   set -a; source .env.local; set +a
//   E2B_TEMPLATE=loop-agent NODE_OPTIONS="--conditions=react-server" \
//     npx tsx scripts/sdk-diag.ts
import { runInSandbox } from "../lib/sandbox";

const probe = [
  `import { query } from '@anthropic-ai/claude-agent-sdk';`,
  `process.env.HOME = process.env.HOME || '/home/user';`,
  `let turns=0, res='ok', note='';`,
  `try {`,
  `  const q = query({ prompt: 'Reply with the single word READY and nothing else.', options: {`,
  `    cwd: process.cwd(), model: process.env.AGENT_SDK_MODEL || 'claude-sonnet-4-6', maxTurns: 1,`,
  `    permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,`,
  `    allowedTools: ['Read'], executable: 'node',`,
  `    stderr: (d) => process.stdout.write('CCSTDERR| '+String(d)),`,
  `  }});`,
  `  for await (const m of q) { if(m?.type==='assistant') turns++; if(m?.type==='result') note=String(m.subtype??m.result??'').slice(0,200); }`,
  `} catch(e){ res='error'; note=(e?.message||String(e)).split('\\n').slice(0,3).join(' | ').slice(0,300); }`,
  `console.log('PROBE_TURNS='+turns); console.log('PROBE_RESULT='+res); console.log('PROBE_NOTE='+note);`,
].join("\n");

const sh = [
  `set -uo pipefail`,
  `export HOME=/home/user`,
  `GH="\${GITHUB_TOKEN:-}"; unset GITHUB_TOKEN`,
  `cd "$HOME"; rm -rf w`,
  `git clone --depth 20 --branch main "https://x-access-token:\${GH}@github.com/LoopLabsfun/loop.git" w >/tmp/c.log 2>&1 || { echo CLONE_FAIL; tail -5 /tmp/c.log; exit 0; }`,
  `cd w`,
  `npm ci --no-audit --no-fund >/tmp/n.log 2>&1 || { echo NPMCI_FAIL; tail -15 /tmp/n.log; exit 0; }`,
  `echo "NODE=$(node -v) HOME=$HOME whoami=$(whoami)"`,
  `echo "CC_BIN: $(find node_modules/@anthropic-ai/claude-agent-sdk -maxdepth 2 -name 'cli.js' 2>/dev/null | head -1 || echo missing)"`,
  // Write the probe INSIDE the repo so node resolves node_modules (the /tmp path had none).
  `cat > probe.mjs <<'PROBE_EOF'`,
  probe,
  `PROBE_EOF`,
  `echo "PROBE_START (IS_SANDBOX=1, as root)"`,
  `IS_SANDBOX=1 node probe.mjs 2>&1 | head -50`,
  `echo "PROBE_DONE rc=$?"`,
  // Fallback test: run the same probe as the non-root `user`.
  `echo "PROBE2_START (as user)"`,
  `chown -R user:user "$PWD" 2>/dev/null || true`,
  `runuser -u user -- env HOME=/home/user ANTHROPIC_API_KEY="\${ANTHROPIC_API_KEY:-}" AGENT_SDK_MODEL="\${AGENT_SDK_MODEL:-claude-sonnet-4-6} " node probe.mjs 2>&1 | head -30 || echo "RUNUSER_RC=$?"`,
  `echo "PROBE2_DONE"`,
].join("\n");

(async () => {
  const r = await runInSandbox(sh, "bash", {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN!,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
    AGENT_SDK_MODEL: process.env.AGENT_SDK_MODEL || "claude-sonnet-4-6",
  }, { timeoutMs: 240000 });
  console.log("ok=", r.ok, "\n--- stdout ---\n" + r.stdout);
  if (r.stderr.trim()) console.log("--- stderr ---\n" + r.stderr.split("\n").slice(-15).join("\n"));
})().catch(e => { console.log("THREW:", e?.message); });
