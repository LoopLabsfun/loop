# Loop — improvement plan & launch roadmap

> Working plan from "prompter → loop designer" thinking. Pairs with
> [agent-runtime.md](agent-runtime.md) (the runtime build plan) and
> [vanity-addresses.md](vanity-addresses.md) (the `…Loop` mint guarantee).

## The thesis in one line

Loop is **three layers**:

1. **The operator** — an autonomous agent per project that builds, emails, posts,
   and reports (the *Polsia* model).
2. **The rubric** — what makes that agent loop *good*: an automation + a skill + a
   state file + an objective gate, with the maker kept away from the checker
   (*loop-engineering*).
3. **The market & governance** — what neither Polsia nor a plain loop has: the
   **market funds the compute** (treasury via trading fees), a **tradable token**
   per project, **pay-to-launch with a no-stuck-funds governed treasury**
   (vote-gated founder withdrawal + pro-rata wind-down), and **two-token
   steering** (project token steers the project; $LOOP steers the platform).

The product bet, stated as the loop-engineering 4th condition made on-chain:
*"the token budget can absorb the waste"* → **empty treasury ⇒ the agent sleeps;
buyers refill it ⇒ it wakes.** The market is the budget.

---

## Part A — Product improvements (priority order)

Each item notes the source insight, who can build it, and the acceptance bar.

> **Status (A1–A4 shipped + budget hard-stop):** the runtime-safety floor is in
> place — A1 verifier gate (#61), budget hard-stop (#62), A2 launch filter (#63),
> A3 honest summaries (#64), A4 standing mandate reread each cycle (#65). All
> env-gated and live in prod.

### A1 · Machine gate (verifier seam) — ✅ shipped (#61)
A project's agent must pass an **objective** check (tests / build / type-check /
lint) run by a **separate verifier**, not self-review. This is the single most
important guardrail: it's what prevents the *Ralph Wiggum loop* (agent emits
"done" early, fails quietly, keeps spending) at the scale of many unattended
agents.
- **Build:** a `lib/verifier.ts` seam — `verify(result) → {passed, signal, detail}`
  — consumed by the runtime's stop condition, mirroring `/goal`'s independent
  checker. Pure/testable now; wired to real CI/sandbox runs later.
- **Done when:** no directive/task is marked `applied`/`shipped` without a
  recorded objective signal; the maker agent never grades its own output.

### A2 · 4-condition launch filter — ✅ shipped (#63)
Be honest at launch: *most projects don't need an autonomous loop yet.* The
LaunchModal should **score/guide** a new project against the four conditions
(repeats? automated verification? budget? senior-eng tools?) and steer founders
toward agent-suitable scopes (a repo with tests) vs judgment-call work.
- **Build:** a lightweight checklist/score in the launch flow; store the answers
  on the project; surface an "agent readiness" badge.
- **Done when:** a founder sees, before paying the stake, whether their project is
  a good agent candidate — protecting the platform's **cost-per-accepted-change**.

### A3 · Honest daily summaries — ✅ shipped (#64, seam; table later)
Polsia's "honest daily summaries" + the article's state discipline: a per-project
**Summary** surface reporting what shipped *and what didn't* ("no ships today" is
valid). The public build log is the social version of *"read the diffs"* —
transparency is the anti-comprehension-debt mechanism.
- **Build now:** a seam (`seedSummaries` + a Summary tab in AgentOperator),
  fallback-simulated. **Later (needs migration):** a `daily_summaries` table.

### A4 · Standing VISION/mandate, reread each cycle — ✅ shipped (#65, seam)
Mitigate *goal drift* (constraints vanish ~turn 47): persist each project's
mandate/VISION and have the runtime reread it every cycle. We already store the
mandate (`defaultMandate`); make it editable + persisted, and the canonical
context the agent reloads.

### A5 · Cross-project learning ($LOOP utility) — 🟡 seam shipped, compounds with runtime
Polsia's compounding edge: anonymized learnings shared across all agents. For
Loop this becomes a **first-class $LOOP utility** beyond voting — the platform
treasury funds a shared "learnings" layer distributed to every project agent
(what outreach converts, which gates catch real bugs). More defensible than a
governance-only token.

**Shipped (no-keys seam):** `public.learnings` table (service-role write, public
read), `lib/learnings.ts` (pure rank/dedupe/format + tests), `getTopLearnings()`
in `agent-data.ts`, and the agent tick now folds the top learnings into its
prompt context (`buildUserPrompt`). It compounds for real once the runtime is on
(it writes new learnings from each run) — the read + distribution path already
works and is seeded.

---

## Part B — Launch roadmap (the deployment sequence)

> The infra already exists: providers `spl` / `pumpfun` / `bags`
> ([launchpad.ts](../lib/launchpad.ts)), SPL mint ([mint-spl.ts](../lib/mint-spl.ts)),
> pump.fun via PumpPortal ([pumpfun.ts](../lib/pumpfun.ts)), the `…Loop` vanity
> pool ([vanity.ts](../lib/vanity.ts)), the on-chain LOOP holdings reader
> ([stake.ts](../lib/stake.ts)), and scripts (`e2e-launch.ts`,
> `devnet-mint-loop.cjs`, `mint-vanity-proof.cjs`). What's missing is keys/SOL.

### Step 1 — Real devnet launch of LOOP (validate the whole pipeline)
Goal: prove mint → vanity `…Loop` → treasury → service-role persist → LOOP
holdings read end-to-end on devnet, with **no real money**.

Prereqs (founder): a devnet keypair at `scripts/.devnet-keypair.json`, funded
from the faucet and holding ≥ 1,000 test-LOOP; env in `.env.local`:
```
LAUNCHPAD_PROVIDER=spl
LAUNCH_CLUSTER=devnet
LAUNCH_SIGNER_SECRET=<json array of the devnet secret key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
LOOP_MINT=<devnet $LOOP mint from scripts/devnet-mint-loop.cjs>   # to exercise the LOOP holdings boost tier
MINT_VANITY_SUFFIX=Loop                                            # optional, to test vanity on devnet
VANITY_POOL=<json array of pre-ground devnet keypairs>            # optional
```
Run + verify:
```
set -a; source .env.local; set +a
NODE_OPTIONS="--conditions=react-server" npx tsx scripts/e2e-launch.ts
```
Done when: the script prints a real devnet `mint`, the persisted row carries it,
and the mint resolves on Solana Explorer (`?cluster=devnet`). `e2e-launch.ts`
self-cleans the test row. Then do **one keeper** launch of the real LOOP project
row (not auto-deleted) to dogfood the live agent against it.

### Step 2 — Remove "devnet-first" — ✅ shipped
Step 1 is green, so the platform is flipped to mainnet-ready:
- Default `SOLANA_NETWORK` (`lib/solana.ts`) / `NEXT_PUBLIC_SOLANA_NETWORK`
  (`lib/network.tsx`) now fall back to `mainnet` (reverse of #46); set either to
  `devnet` for the test cluster. The in-app toggle is unchanged.
- Devnet-only copy/badges audited: the hero eyebrow drops `· DEVNET`, the treasury
  status drops `devnet · no wallet yet`, and the static LOOP fallback row is now
  `network: "mainnet"`. Per-cluster logic stays — devnet remains reachable.

### Step 3 — Mainnet launch on pump.fun with a `…Loop` CA ⚠️ irreversible, real SOL
The flagship LOOP token, live, with a vanity address ending in `Loop`.

Prereqs (founder): `PUMPPORTAL_API_KEY`; `LAUNCH_SIGNER_SECRET` funded with
**real** mainnet SOL (covers pump.fun create + initial buy + fees); a **mainnet**
`VANITY_POOL` ground for `Loop` (`solana-keygen grind --ends-with Loop:N`, see
[vanity-addresses.md](vanity-addresses.md)); env:
```
LAUNCHPAD_PROVIDER=pumpfun
LAUNCH_CLUSTER=mainnet
MINT_VANITY_SUFFIX=Loop
```
Process (safety-first):
1. **Dry-run / preflight** — confirm a vanity keypair is claimable, metadata
   uploads to pump.fun IPFS, and the signer balance covers the spend. No submit.
2. **Smoke launch** — a tiny throwaway token first (pump.fun is mainnet-only and
   not covered by CI), to validate the live PumpPortal path end-to-end.
3. **Launch LOOP** — only on explicit founder go, with the final name/ticker/
   metadata locked. Record the mint, tx sig, and pump.fun URL.
4. **Post-launch** — verify the `…Loop` CA on Solscan; wire the treasury; point
   the live agent at it.

> ⚠️ Steps 3.2–3.4 spend real SOL and are irreversible — executed only on an
> explicit per-step "go", never autonomously.

---

## Part C — Founder key checklist (all confirmed available)

| Key | Unblocks | Step |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | persist real launches + runtime writes | 1, 3 |
| `LAUNCH_SIGNER_SECRET` (devnet, funded) | devnet mint/treasury | 1 |
| `LOOP_MINT` (devnet) | read LOOP holdings (model boost tier) | 1 |
| `PUMPPORTAL_API_KEY` | pump.fun create | 3 |
| `LAUNCH_SIGNER_SECRET` (mainnet, real SOL) | pay for the mainnet launch | 3 |
| mainnet `VANITY_POOL` (`Loop`) | the `…Loop` CA | 3 |
| `ANTHROPIC_API_KEY` | the real agent brain (separate track) | runtime |

All server-only (no `NEXT_PUBLIC_` prefix); set in `.env.local` and Vercel.

---

## Part D — "Definition of a good Loop agent" (acceptance bar)

Every per-project agent must satisfy these, drawn from the loop-engineering
failure modes — they are the gate for turning the simulated seam live:

- [ ] **Objective gate** — an automated check can *fail* its work (A1).
- [ ] **Maker ≠ checker** — a separate verifier, ideally a different model.
- [ ] **External state** — tasks/actions/escalations/**directives** persisted
      (done: `agent_*` + `directives` tables) so a run *resumes*, not restarts.
- [ ] **Standing spec reread** — mandate/VISION reloaded each cycle (A4).
- [ ] **Hard stop** — treasury budget + iteration cap; empty treasury ⇒ sleep.
- [ ] **Human gate on the irreversible** — escalation ladder (founder → DAO →
      prudent default) for treasury moves, identity, public commitments.
- [ ] **Transparency** — the public action log is the "read the diffs" mitigation.
- [ ] **Security** — per-project isolation (E2B), SAST/secret-scan on generated
      PRs, audited skills, no creds in logs, permissions re-audited every 30 days.

---

## Sequencing

1. **Now (no keys):** A1 verifier seam → A2 launch filter → A3/A4 seams.
2. **On keys:** Step 1 devnet launch → dogfood LOOP's real agent (needs
   `ANTHROPIC_API_KEY` + `SUPABASE_SERVICE_ROLE_KEY`).
3. **After devnet green:** Step 2 remove devnet-first.
4. **On explicit go:** Step 3 mainnet pump.fun `…Loop` launch (dry-run → smoke →
   LOOP).

*Build small, keep the gate honest, stay the engineer.*

---

## Turning on the real hands (runbook)

The agent's brain, the E2B sandbox, GitHub and the service-role key are all wired
and live — but in prod the **real hands are still off**, so the agent plans/posts
but has never committed code. The `*/2` cron was also **deregistered** (`5008eb8`)
to stop burning quota while the gate couldn't ship; this work restores it. Three
things switch the hands on; all are cheap and gated.

### 1. Build the warm E2B template (one-time, repeat on big lockfile changes)

Without a custom template the per-cycle gate cold-`npm ci`s on E2B's base image
and blows the cron budget. `scripts/e2b-template.ts` bakes a template
(`loop-agent`) on the **code-interpreter** base + git + a **warm npm cache** from
`package-lock.json`:

```
set -a; source .env.local; set +a
npx tsx scripts/e2b-template.ts          # builds + publishes "loop-agent"
```

Verify it end-to-end (clone → npm ci → tsc → vitest, no push):

```
E2B_TEMPLATE=loop-agent NODE_OPTIONS="--conditions=react-server" \
  npx tsx scripts/verify-e2b-gate.ts     # expect GATE_RESULT=ok, ~130s total
```

Gotchas baked into the code (don't regress them): the gate clones onto
`/home/user` **not `/tmp`** (tmpfs is ~2G; `node_modules` is ~2.3G → ENOSPC); the
template copies `.npmrc` so `legacy-peer-deps=true` lets `npm ci` resolve; the
sandbox run uses a raised `timeoutMs` (the gate far exceeds E2B's ~60s default);
and step output is redirected to a log so the Jupyter kernel's IOPub rate-limit
can't drop the `GATE_RESULT`/`PUSHED` markers.

### 2. Flip the switches (locally, then Vercel Production)

| Env | Effect |
|---|---|
| `E2B_TEMPLATE=loop-agent` | the gate runs in the warm template (fast `npm ci`) |
| `AGENT_REPO_HANDS=1` | the agent's `edits` are applied + **pushed to main if green** |
| `AGENT_GATE_BUILD=1` *(optional)* | also run `next build` in the gate (catches route breakage; needs the warm template's headroom) |
| `AGENT_CLAIM_FEES=1` *(optional)* | sweep pump.fun creator fees → treasury each cron (self-funding loop) |

Plus a funded `ANTHROPIC_API_KEY` (recharge credits) and the restored `*/2` cron
(this PR). Recommended order: build + verify the template → set `E2B_TEMPLATE` →
watch one green dry-run → set `AGENT_REPO_HANDS=1` → confirm a real
`feat(agent): …` commit lands → then optionally `AGENT_GATE_BUILD` /
`AGENT_CLAIM_FEES`.

> Budget note: a full real-commit gate is ~130s, so with `MAX_PER_RUN=3` only
> ~one repo-hands commit fits per cron tick — fine while LOOP is the sole funded
> project; revisit (parallelise / raise `maxDuration`) as funded projects grow.

### 3. Make the brain explore, not guess (`AGENT_READ_ROUNDS`)

Once the hands ship, the ceiling on quality is the *brain*. The agent reads real
files before editing (the A2 path), but historically got exactly ONE read round
(≤6 files, then it MUST act) — so on anything non-trivial it edited half-blind: it
couldn't read a file, see what it imports, and read that too. `AGENT_READ_ROUNDS=N`
turns that single pass into a bounded **iterative read loop** (read → reflect →
read more → edit), which is the single biggest lever on the agent's "intelligence"
— more than the model. Bounded hard (cap 6 rounds, `AGENT_READ_MAX_FILES` total)
because each round is another Opus call. Unset/`1` = the original single-round
behavior, so it's a safe, env-gated rollout: set `AGENT_READ_ROUNDS=4` in Vercel
Production when you want the agent to actually build a mental model before it edits.
This is the contained first step toward the full Claude-Agent-SDK in-sandbox loop
(read/grep/edit/run, iterate to green) that the runtime ultimately wants.

### 4. Claude Agent SDK hands — the real loop (`AGENT_SDK_HANDS`, Phase 1)

The end of the line for "intelligence": instead of the brain emitting full-file
`edits`, a **bounded Claude Agent SDK session runs INSIDE the E2B sandbox** and does
the engineering itself — reads/greps/edits and **runs the tests**, iterating like
Claude Code — then we gate + push. Decision: run it **in-budget on Vercel** (no
Trigger.dev yet), so each session is time-boxed to fit the 300s cron. Phase 1 =
dogfood the LOOP repo only.

Pieces: `scripts/agent-sdk-session.mjs` (the headless `query()` runner, locked-down
`allowedTools` + `permissionMode: bypassPermissions`), `lib/agent-sdk-hands.ts`
(`buildSdkHandsScript`: clone → session → denylist-on-diff → gate → push), wired in
`runAgentTick` as the precedence path for `feature`/`fix` tasks.

Safety: the **session runs with NO `GITHUB_TOKEN`** in its env (captured + `unset`
before it, re-used only for clone/push) so it can't push or exfiltrate; the **diff
is denylist-checked** (same `DENY_PATH_PREFIXES` as repo-hands) before commit; the
**independent gate** (tsc + tests, optional `next build`) still gates the push
(maker≠checker). Bounded by `AGENT_SDK_MAX_TURNS` + a wall-clock kill, throttled by
`AGENT_SDK_MIN_INTERVAL_MS` (~15 min) since a session is many model calls.

Turn-on (after recharge): build the SDK template
(`E2B_TEMPLATE_NAME=loop-agent-sdk npx tsx scripts/e2b-template.ts`) → dry-run
(`E2B_TEMPLATE=loop-agent-sdk npx tsx scripts/verify-sdk-session.ts` — edits + gate
green, never pushes, reports turns + wall time) → set `E2B_TEMPLATE=loop-agent-sdk`
+ `AGENT_SDK_MODEL` → `AGENT_SDK_HANDS=1` → confirm a real SDK-authored
`feat(agent): …` lands green → watch cost. The full Trigger.dev durable-run version
(sessions that finish a whole feature) is the next step if 240s proves too short.

---

## Cron cadence (Hobby vs. finer)

Vercel **Hobby** allows **one daily cron only**, so `vercel.json` runs the agent
tick once a day (`0 8 * * *`, 08:00 UTC). The tick is already bounded
(`MAX_PER_RUN`) and budget-gated, so daily is a safe floor.

For a finer cadence **without upgrading to Pro**, point an external scheduler at
the same endpoint — it's protected by `CRON_SECRET`:

```
curl -fsS https://loop-fun-nine.vercel.app/api/agent/cron \
  -H "Authorization: Bearer $CRON_SECRET"
```

Options: GitHub Actions `schedule` (free, ~5-min granularity), cron-job.org, or
Upstash QStash. Keep the daily Vercel cron as a backstop. Upgrading to Vercel
Pro instead unlocks arbitrary cron expressions (restore `0 * * * *` for hourly).
