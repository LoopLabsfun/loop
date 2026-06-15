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
   per project, a **transferable Founder Stake**, and **two-token steering**
   (project token steers the project; $LOOP steers the platform).

The product bet, stated as the loop-engineering 4th condition made on-chain:
*"the token budget can absorb the waste"* → **empty treasury ⇒ the agent sleeps;
buyers refill it ⇒ it wakes.** The market is the budget.

---

## Part A — Product improvements (priority order)

Each item notes the source insight, who can build it, and the acceptance bar.

### A1 · Machine gate (verifier seam) — 🟢 buildable now
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

### A2 · 4-condition launch filter — 🟢 buildable now
Be honest at launch: *most projects don't need an autonomous loop yet.* The
LaunchModal should **score/guide** a new project against the four conditions
(repeats? automated verification? budget? senior-eng tools?) and steer founders
toward agent-suitable scopes (a repo with tests) vs judgment-call work.
- **Build:** a lightweight checklist/score in the launch flow; store the answers
  on the project; surface an "agent readiness" badge.
- **Done when:** a founder sees, before paying the stake, whether their project is
  a good agent candidate — protecting the platform's **cost-per-accepted-change**.

### A3 · Honest daily summaries — 🟡 UI seam now, table later
Polsia's "honest daily summaries" + the article's state discipline: a per-project
**Summary** surface reporting what shipped *and what didn't* ("no ships today" is
valid). The public build log is the social version of *"read the diffs"* —
transparency is the anti-comprehension-debt mechanism.
- **Build now:** a seam (`seedSummaries` + a Summary tab in AgentOperator),
  fallback-simulated. **Later (needs migration):** a `daily_summaries` table.

### A4 · Standing VISION/mandate, reread each cycle — 🟡 seam now
Mitigate *goal drift* (constraints vanish ~turn 47): persist each project's
mandate/VISION and have the runtime reread it every cycle. We already store the
mandate (`defaultMandate`); make it editable + persisted, and the canonical
context the agent reloads.

### A5 · Cross-project learning ($LOOP utility) — 🔴 design now, build with runtime
Polsia's compounding edge: anonymized learnings shared across all agents. For
Loop this becomes a **first-class $LOOP utility** beyond voting — the platform
treasury funds a shared "learnings" layer distributed to every project agent
(what outreach converts, which gates catch real bugs). More defensible than a
governance-only token.

---

## Part B — Launch roadmap (the deployment sequence)

> The infra already exists: providers `spl` / `pumpfun` / `bags`
> ([launchpad.ts](../lib/launchpad.ts)), SPL mint ([mint-spl.ts](../lib/mint-spl.ts)),
> pump.fun via PumpPortal ([pumpfun.ts](../lib/pumpfun.ts)), the `…Loop` vanity
> pool ([vanity.ts](../lib/vanity.ts)), the on-chain stake gate
> ([stake.ts](../lib/stake.ts)), and scripts (`e2e-launch.ts`,
> `devnet-mint-loop.cjs`, `mint-vanity-proof.cjs`). What's missing is keys/SOL.

### Step 1 — Real devnet launch of LOOP (validate the whole pipeline)
Goal: prove mint → vanity `…Loop` → treasury → service-role persist → stake gate
end-to-end on devnet, with **no real money**.

Prereqs (founder): a devnet keypair at `scripts/.devnet-keypair.json`, funded
from the faucet and holding ≥ 1,000 test-LOOP; env in `.env.local`:
```
LAUNCHPAD_PROVIDER=spl
LAUNCH_CLUSTER=devnet
LAUNCH_SIGNER_SECRET=<json array of the devnet secret key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
LOOP_MINT=<devnet $LOOP mint from scripts/devnet-mint-loop.cjs>   # to exercise the stake gate
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

### Step 2 — Remove "devnet-first"
Once Step 1 is green, flip the platform to mainnet-ready:
- Default `SOLANA_NETWORK` / `NEXT_PUBLIC_SOLANA_NETWORK` back to `mainnet`
  (reverse of #46), keep the in-app toggle for testing.
- Audit any devnet-only copy/badges; keep devnet reachable but not the default.
- 🟢 I can do this PR-only once Step 1 is validated.

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
| `LOOP_MINT` (devnet) | exercise the 1,000-LOOP stake gate | 1 |
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
