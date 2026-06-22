# State of Loop — architecture audit & engineering onboarding

> **Audience:** the engineers we're bringing in to help finish the product and
> relaunch the token. This is the honest, top-to-bottom map of what loop.fun
> *is*, how it *actually works in production today*, what is live vs. gated vs.
> missing, and the exact path to a 100%-autonomous platform open to public
> project creation.
>
> Written 2026-06-22 from a full inspection of the codebase, git history, the
> live Vercel project, the Supabase database, and the Trigger.dev wiring. Pairs
> with [VISION.md](../VISION.md) (the product roadmap the agent itself follows),
> [agent-runtime.md](agent-runtime.md), [loop-roadmap.md](loop-roadmap.md),
> [loop-economics.md](loop-economics.md), and [mainnet-readiness.md](mainnet-readiness.md).

---

## 0. The one-paragraph pitch

**loop.fun is an "autonomous software factory" on Solana.** It's a Pump.fun-style
launchpad where every project gets four things at once: a **tradable token**, an
**on-chain treasury**, a **cloud environment**, and a **real autonomous AI agent
that builds the product** — and it builds *while the treasury is funded*. The
market is the budget: buyers refill the treasury → the agent wakes and ships;
the treasury empties → the agent sleeps. The first project is **LOOP itself** —
the platform funds its own development, in public, as the flagship dogfood.

The mental model is **"Polsia, but funded by an on-chain market and steered by a
token."** Polsia = an AI that runs a startup (ships code, does outreach, keeps an
inbox, reports honest daily summaries). Loop adds the layer Polsia doesn't have:
a **market that funds the compute** and a **token that governs the work.**

---

## 1. The three layers (the product thesis)

Everything in the repo maps onto one of three layers. Keep these in mind and the
code organizes itself.

1. **The operator** — one autonomous agent per project that builds, posts,
   (eventually) emails, manages its token, and reports. *(Polsia model.)*
2. **The rubric** — what makes that agent loop *good*, not a runaway: an
   **automation + a skill + a state file + an objective gate**, with the
   **maker kept separate from the checker**. *(loop-engineering discipline.)*
3. **The market & governance** — what neither Polsia nor a plain agent loop has:
   the **market funds the compute** (trading fees → treasury), a **tradable token
   per project**, **pay-to-launch with a no-stuck-funds governed treasury**
   (vote-gated founder withdrawal + pro-rata wind-down), and **two-token
   steering** (the project token steers *that* project; **$LOOP** steers the
   *platform*).

---

## 2. Stack at a glance

| Concern | Tech | Where |
|---|---|---|
| Web app | **Next.js 14 (App Router) + React 18 + TypeScript** | `app/`, `components/` |
| Styling | **Tailwind 3**, design tokens as CSS vars (light/violet, oklch accent) | `app/globals.css`, `tailwind.config.ts` |
| Database | **Supabase** (Postgres), ref `aysetvbjlzhnswkznxjh` | `lib/supabase.ts`, `supabase/schema.sql` |
| Chain reads | **Solana web3.js + Helius RPC** (server-only) | `lib/solana.ts` |
| Auth / wallets | **Privy** (server wallets for agent custody) | `lib/privy.tsx`, `lib/agent-wallet.ts` |
| Agent brain | **Anthropic SDK** (`claude-opus-4-8`, structured output) | `lib/agent-runtime.ts` |
| Agent hands | **Claude Agent SDK** running inside an **E2B sandbox** | `lib/agent-sdk-hands.ts`, `lib/sandbox.ts` |
| Durable orchestration | **Trigger.dev v4** (the part that won't fit Vercel's 300s cron) | `trigger.config.ts`, `trigger/agent-session.ts` |
| Token launch | **SPL mint / Pump.fun (PumpPortal) / Bags**, `…Loop` vanity addresses | `lib/launchpad.ts`, `lib/pumpfun.ts`, `lib/vanity.ts` |
| Hosting | **Vercel** — team `loop-labs-fun`, project `loop`, Node 24.x | `vercel.json` |
| Heartbeat | **Vercel Cron** (`*/2`) + **GitHub Actions** (`*/5` backstop) | `vercel.json`, `.github/workflows/agent-cron.yml` |

Repo: **`github.com/LoopLabsfun/loop`** (private, organization-owned).
Live domains: **`looplabs.fun`**, `www.looplabs.fun`.

---

## 3. The data seam (why the UI never breaks)

The central design idea: **the UI is built against a typed seam, so simulated
data can be swapped for live data without touching components.** All domain
types live in `lib/types.ts`. Three sources sit behind the seam:

1. **Live — Supabase** (`lib/queries.ts`, `lib/actions.ts`). `getProjects()` /
   `getProject(key)` read the `projects` table and **fall back to the static
   registry** in `lib/projects.ts` if Supabase is unconfigured or fails — the UI
   renders on a cold backend.
2. **Live — Helius/Solana** (`lib/solana.ts`, server-only). When a project row
   has a `treasury_wallet`, `withLiveBalances()` overrides the stored snapshot
   with the real on-chain balance.
3. **Simulated** (`lib/api.ts` + the `useLoopEngine` / `useTokenMarket` hooks).
   The "live feel" animated client-side — the layer being progressively made real.

**Rule for new work:** extend the seam in `lib/queries.ts` / `lib/api.ts` and
keep the static fallback path working. A component must never need a configured
backend to render.

---

## 4. The agent runtime — how it ACTUALLY runs in production

This is the heart of the product and the part most worth understanding. The flow,
end to end:

```
 Vercel Cron */2  ─┐
                   ├─►  GET /api/agent/cron   (auth: Bearer $CRON_SECRET)
 GH Actions */5  ──┘          │
   (backstop)                 ▼
                    ┌─ budget gate: canAffordTick(p)  ── empty treasury ⇒ SLEEP
                    │   (lib/budget.ts: treasury must cover ≥ 1 cycle's burn)
                    ▼
              for each funded project (≤ MAX_PER_RUN = 3):
                    │
        ┌───────────┴───────────────────────────────────────────────┐
        │  BRAIN  (lib/agent-runtime.ts › decideNextAction)          │
        │  Claude Opus 4.8, structured-output JSON decision.         │
        │  Context it's grounded in EVERY tick:                      │
        │   • standing mandate (reread → anti drift, A4)             │
        │   • shared learnings across projects (A5)                  │
        │   • REAL recent commits + REAL file tree (no hallucinated  │
        │     "initialize the repo")                                 │
        │   • current tasks + last verifier outcome (episodic mem B) │
        │   • untrusted steering directives (fenced as DATA)         │
        │  Iterative READ loop (AGENT_READ_ROUNDS): read→reflect→    │
        │  read more→act, before it edits.                           │
        └───────────┬───────────────────────────────────────────────┘
                    ▼  decision = {summary, task, edits?, command?, action?, posts?, learning?}
        ┌───────────┴───────────────────────────────────────────────┐
        │  HANDS  (precedence order, all env-gated OFF by default)   │
        │  1. SDK hands  (AGENT_SDK_HANDS): a Claude Agent SDK       │
        │     session runs INSIDE E2B — reads/greps/edits/runs the   │
        │     tests itself (Claude-Code-style), then gate + push.    │
        │  2. Repo hands (AGENT_REPO_HANDS): brain emits full-file   │
        │     `edits` → E2B clone → gate → push to main if green.    │
        │  3. Plain `command`: run code in the sandbox for proof.    │
        └───────────┬───────────────────────────────────────────────┘
                    ▼
        ┌───────────┴───────────────────────────────────────────────┐
        │  VERIFIER GATE (A1, maker ≠ checker — lib/verifier.ts)     │
        │  A self-declared "shipped" only sticks if an INDEPENDENT   │
        │  sandbox check actually ran & passed this cycle. The push  │
        │  (PUSHED=yes) IS the ship signal. No green check ⇒ held at  │
        │  "building" (the Ralph-Wiggum guardrail).                  │
        └───────────┬───────────────────────────────────────────────┘
                    ▼
            applyDecision → Supabase (service_role):
              agent_tasks · agent_posts · agent_actions · learnings
              + Telegram / X posts (throttled) + on-chain action routing
```

### 4.1 What gates the agent (the safety floor — all shipped & live)

- **A1 · Verifier gate** (`lib/verifier.ts`) — maker ≠ checker; nothing ships
  without an objective sandbox pass. The single most important guardrail.
- **A2 · Launch filter** — scores a new project against the 4 conditions before
  it's accepted as an agent candidate.
- **A3 · Honest summaries** — "no ships today" is a valid, reported state.
- **A4 · Standing mandate, reread each cycle** — mitigates goal drift.
- **A5 · Cross-project learnings** (`lib/learnings.ts`) — anonymized insights
  shared across every agent (a first-class $LOOP utility).
- **Budget hard-stop** (`lib/budget.ts`) — empty treasury ⇒ sleep. The agent
  **cannot** burn money on a starved project.
- **Directive-injection defense** — steering directives are **untrusted data**,
  fenced, never executed; the agent has **no ability to transfer treasury funds**
  to an arbitrary wallet, by construction (not just by prompt). This closed a
  real attempted drain (2026-06-18).

### 4.2 On-chain actions

The brain may propose a `buyback / burn / airdrop / bounty / swap` on its own
token. `routeAction` (`lib/agent-runtime.ts`) sends it through the guardrails:
**irreversible (burn/airdrop) or over-budget ⇒ escalate to the founder**, never
auto-executed. A permitted **buyback** executes for real via **Privy custody +
Jupiter** (`lib/agent-actions-exec.ts`). One real buyback has already run on
mainnet (0.1 SOL → ~528K $LOOP).

### 4.3 Economics — the self-funding loop

Built on **Pump.fun native creator-fee sharing** (route fees to up to 10 wallets).
Default split (`lib/fees.ts`): **30% founder / 65% agent / 5% platform.** The
agent's 65% refills its own wallet on every trade, funding its compute and
on-chain actions — *as long as the coin trades, the agent keeps building.*
`AGENT_CLAIM_FEES=1` makes each cron sweep accrued creator fees → treasury,
closing the loop ("buyers refill it ⇒ it wakes").

---

## 5. The durable brain — Trigger.dev (just installed)

**Why it exists:** a real Claude-Agent-SDK coding session (read → edit → run
tests → iterate to green → push) takes *minutes*, but a Vercel function caps at
**300s**. Trigger.dev is the durable host that lifts that cap.

**How it's wired (`AGENT_BRAIN=sdk`):**
- The Vercel cron becomes the cheap **brain/heartbeat**: it `decideNextAction`s,
  and for a **code task** calls `enqueueSdkSession` (`lib/agent-session-enqueue.ts`)
  → `tasks.trigger("agent-session", payload)` instead of running inline.
- The durable task `trigger/agent-session.ts` (`maxDuration: 25min`,
  `retries: 1` — never double-push) runs the pre-built bash **script** in a warm
  **E2B sandbox** with a real budget: clone → `npm ci` → bounded Claude Agent SDK
  session edits + tests itself → denylist the diff → independent gate → push if
  green → **POST the stdout back to `/api/agent/session/finish`**, which parses
  the markers and persists via `applyDecision` (verifier gate intact).
- **Secrets live on the Trigger worker, never in the payload.** The script
  references `$VARS`; the worker injects `GITHUB_TOKEN` / `ANTHROPIC_API_KEY` /
  etc. from its own env. The in-sandbox session runs **without** `GITHUB_TOKEN`
  (can't push or exfiltrate) — clone/push happen outside it.

**Config:** Trigger project ref `proj_xcnutrkjanmeunvpjukz` (`trigger.config.ts`).

**What's blocking it (activation, not code):**
1. **Deploy the worker** — `npx trigger.dev@latest deploy` (needs a CLI login /
   `tr_pat` personal access token), **or** rely on the Vercel↔Trigger integration
   to deploy it on push. Until the `agent-session` task is deployed,
   `tasks.trigger` has nothing to run.
2. **Set the worker env vars** on Trigger.dev (not Vercel): `E2B_API_KEY`,
   `E2B_TEMPLATE`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `AGENT_TICK_SECRET`,
   `LOOP_SITE_URL`. ✅ **Done 2026-06-22** via `scripts/trigger-set-env.ts`
   (uploaded to the Production environment, `result: success`).
3. **Set `TRIGGER_SECRET_KEY` in Vercel** (the enqueue side; typically synced by
   the Vercel↔Trigger integration) + flip `AGENT_BRAIN=sdk`.
4. **Rebuild the warm E2B template.** A first dry-run of the SDK-in-E2B session
   (`scripts/verify-sdk-session.ts`, 2026-06-22) **timed out at 8 min**: the
   `loop-agent` template's warm npm cache predated the Trigger.dev + Claude Agent
   SDK additions (`fd547cb` changed ~1235 lockfile lines), so `npm ci` re-fetched
   them cold. ✅ **Fixed 2026-06-22** — the template was rebuilt
   (`npx tsx scripts/e2b-template.ts`, warm cache now covers all 1718 packages,
   build 2m32s). The *mechanism* is sound; a full session still wants the
   **durable Trigger.dev host** (25 min), not a short cron cap — which is exactly
   the path that's wired.

> Uncommitted helper scripts present in the tree: `scripts/trigger-set-env.ts`,
> `scripts/sweep-agent-wallet.ts`, `sdk-diag.ts` (an E2B probe that diagnosed the
> "Claude Code refuses root" issue — fixed by `IS_SANDBOX=1` + `HOME`, commit
> `49ac4d5`). These should be committed or removed before the next clean push.

---

## 6. Current REAL state (from live inspection, 2026-06-22)

### Supabase (`aysetvbjlzhnswkznxjh`) — the agent has been running

| Table | Rows | Meaning |
|---|---:|---|
| `projects` | 1 | Only LOOP exists (public launches still closed) |
| `agent_tasks` | 51 | The agent has planned/worked 51 tasks |
| `agent_posts` | 65 | 65 social posts published |
| `directives` | **496** | Heavy public steering input (incl. the injection attempt) |
| `directive_votes` | 23 | Governance votes cast |
| `learnings` | 11 | Cross-project learnings accumulated |
| `agent_actions` | 1 | One real on-chain action (the buyback) |
| `vanity_keypairs` | 91 | Pre-ground `…Loop` mint pool |
| `agent_escalations` | 0 | None yet |
| `agent_emails` | 0 | Email not wired (no inbound domain routing) |
| `fee_ledger` / `compute_ledger` | 0 | Accounting seams not yet populated |

**Takeaway:** the brain + persistence + posting + governance + one real on-chain
action are *demonstrably live*. The **hands** (autonomous code commits) and the
**durable Trigger path** are the parts not yet delivering.

### ⚠️ Current status: the agent is ASLEEP (treasury empty)

Verified 2026-06-22:
- The cron heartbeat is **healthy** — `/api/agent/cron` returns `200` every 2 min.
- But the agent has produced **nothing since 2026-06-19 02:39** (0 tasks in the
  last 72h), and its last post/action are also from June 19.
- Reason: the treasury wallet `7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9`
  holds **0 SOL on-chain** (`burn_per_day` is `0.00 SOL/day`, so the wake
  threshold is the `0.01 SOL` dust floor). The **budget hard-stop**
  (`lib/budget.ts`) therefore returns `asleep`, the cron skips the project, and
  no brain/hands run. **This is the design working as intended** ("empty treasury
  ⇒ the agent sleeps"), not a bug.

**Consequence — this is the real root cause behind "nothing is happening / the
token is dead":** at ≈$1.9k mcap there is ~no trading → ~no creator fees → the
treasury stays at 0 → the agent sleeps → no visible building → the token stays
dead. It's a death spiral that **no env flip can break** (Trigger.dev,
`AGENT_BRAIN=sdk`, `AGENT_REPO_HANDS` all no-op while the treasury is empty).

**To break it, the founder must prime the pump (see [VISION.md](../VISION.md) P0):**
1. **Fund the treasury** wallet with a little SOL (even ~0.05–0.5 SOL) → the
   agent wakes on the next cron tick and resumes building. (Anthropic spend runs
   on `ANTHROPIC_API_KEY` credits, separate from treasury SOL — the treasury
   balance is the *permission-to-run* signal + the on-chain action budget.)
2. And/or set `AGENT_CLAIM_FEES=1` so each cron sweeps any **accrued pump.fun
   creator fees** (`earned_sol` shows ~0.055 recorded) into the treasury —
   self-funding once there's fee flow.

### Vercel — project `loop`, team `loop-labs-fun`

- Git-connected auto-deploy from `LoopLabsfun/loop` (org-owned, private), Node 24.x.
- Latest production deploy READY; rollback candidates present. Healthy.

---

## 7. "Why is godisrupt still deploying, not Loop Labs Fun?" — answered

**Short answer: the project is ALREADY 100% under the org. The "godisrupt" label
is a pusher-identity artifact, not an ownership problem — and the real fix is the
same thing as making the platform autonomous.**

What the live data shows:
- The repo is `LoopLabsfun/loop`, `githubRepoOwnerType: "Organization"`, private.
- The Vercel project lives under **team `loop-labs-fun`** (`team_IJTvACb9oBZaYCOxQdbxxTOo`),
  **not** a personal account.
- Deploys are **Git-triggered** (`githubDeployment: "1"`), auto-deploying `main`.

So why does every deployment read `creator: godisrupt`? Because **Vercel
attributes a Git deployment to the team member whose linked GitHub identity
pushed the commit** — and **every commit is authored and pushed by
`godisrupt <contact@godisrupt.fr>`** (that's your local `git config`, and the PR
merges). A few deploys *do* show `creator: contact@looplabs.fun` with
`actor: claude-code…agent` — those are the ones triggered through the org
account. Nothing is mis-owned; the human pushing is just you.

**The fix is the autonomy goal itself — "no human pushes to main":**
1. **Turn on the agent's hands** (`AGENT_REPO_HANDS=1` and/or `AGENT_SDK_HANDS=1`,
   or `AGENT_BRAIN=sdk` once Trigger is deployed). The agent then pushes to main
   **authored as `loop-agent <agent@looplabs.fun>`** (already the case in
   `buildSdkHandsScript` / `buildHandsScript`), and Vercel auto-deploys from that
   push. Deployments become attributed to the agent, not you.
2. **For any remaining human pushes, use an org identity** — a dedicated
   `loop-bot` GitHub machine user (or `contact@looplabs.fun`) added to the org +
   the Vercel team, instead of merging as `godisrupt`.
3. **Stop manual `vercel --prod` from your laptop** — that logs the deploy under
   your personal CLI session. Rely on Git push → auto-deploy only.

> Net: ownership = done. Attribution = a side effect of you being the one who
> pushes. Let the agent push (the whole point of the product) and the problem
> disappears.

---

## 8. Gap analysis — LIVE vs. GATED vs. MISSING

### ✅ Live in production
- Full frontend (landing, `/token`), the data seam, Supabase persistence, Helius
  live treasury balances.
- The agent **brain** (Opus structured-output tick) with all guardrails A1–A5 +
  budget hard-stop + injection defense.
- Real on-chain: one executed buyback, Privy custody, the `…Loop` vanity pool.
- Telegram + X posting seams (throttled, kill-switchable).

### 🟡 Built, gated OFF (a single env switch from live — no code needed)
- **Agent hands** — `AGENT_REPO_HANDS` / `AGENT_SDK_HANDS` (the agent commits
  code). Needs a warm `E2B_TEMPLATE` + write-scoped `GITHUB_TOKEN`.
- **Durable brain** — `AGENT_BRAIN=sdk` (Trigger.dev). Blocked on the worker
  deploy + worker env (§5).
- **Self-funding** — `AGENT_CLAIM_FEES=1` (sweep creator fees → treasury).
- **White-label provisioning** — `GITHUB_TOKEN` + `VERCEL_TOKEN` +
  `VERCEL_TEAM_ID` (`lib/provisioning.ts` already plans `LoopLabsfun/<slug>`).
- **Public launches** — `NEXT_PUBLIC_LAUNCHES_OPEN=true`.

### 🔴 Genuinely missing (needs new code or a provider)
- **Pay-to-launch on-chain** — collect the launch payment / bonding-curve buy and
  record the **verified creator wallet (signature proof)** before inserting a
  funded row. (The RLS is already hardened to forbid spoofed official/funded rows.)
- **Email inbound** — a real domain's router (Cloudflare Email Routing) → POST
  `/api/email/inbound` → `agent_emails`. Send seam exists; receive doesn't.
- **Per-project agent wallets at scale** — Privy/Turnkey server wallet *per*
  project (today: one LOOP wallet).
- **Per-project social/Telegram provisioning** — today one shared LOOP channel.
- **Token relaunch + marketing** — the token is low; see [VISION.md](../VISION.md) §Relaunch.

---

## 9. How an incoming engineer helps — by area

| If you know… | Own this |
|---|---|
| **DevOps / Trigger.dev / E2B** | Deploy the Trigger worker, set its env, prove one green `agent-session` run end-to-end. Unblocks the durable brain (§5). |
| **Solana / SPL / Pump.fun** | Pay-to-launch with on-chain signature proof; per-project agent wallets; the creator-fee claim → treasury loop. |
| **Next.js / product** | Public-launch flow (`NEXT_PUBLIC_LAUNCHES_OPEN`), the launch modal's agent-readiness scoring, the multi-project dashboard. |
| **Infra / email** | Cloudflare Email Routing → `/api/email/inbound` → `agent_emails`; SPF/DKIM/DMARC for `<slug>@agents.looplabs.fun`. |
| **AI / agents** | The brain quality: the read loop, the SDK-hands session prompt, the verifier checks, cross-project learnings. |
| **Growth / token** | The relaunch plan + build-in-public cadence (see VISION.md). |

**Local setup:** copy `.env.example` → `.env.local`, `npm i`, `npm run dev`.
`npm run build` before pushing (catches type/route errors). `npx tsc --noEmit`
and `npm test` (vitest) are the gates the agent itself must pass — keep them green.

---

## 10. The honest verdict

The **product is code-complete for Phase 1** and the **agent is live and
producing real data.** What remains is **activation, not invention**: deploy the
Trigger worker, flip the hands on, wire pay-to-launch + email, open public
launches. The single highest-leverage move — which also resolves the "godisrupt
deploys" question — is to **let the agent push its own code to main.** Everything
else is sequencing (see [VISION.md](../VISION.md)).
