# Deploying a real agent per project

> Engineering recommendation for turning the simulated **Agent Console** /
> **Agent Operator** seam (`lib/console.ts`, `lib/agent.ts`) into real
> autonomous agents — one per project — modelled on the Polsia pattern
> (ships code, runs outreach, keeps an email inbox, manages social, reports
> honest daily summaries) plus Loop's on-chain layer (treasury-funded,
> stake-steered, DAO-governed).

This doc is the **founder-facing build plan**. The UI already renders against
the seam, so none of this requires touching components — we swap each seam
function for a live source, exactly as the project already does for treasury
balances (Helius) and project rows (Supabase).

---

## 1. The shape of one agent

Each project = **one durable, long-running agent** that wakes, does a unit of
work, accounts for spend, and sleeps. It is **funded while the treasury has
SOL** and **steered by its mandate** (mission + budget + guardrails) which the
founder sets and holders can amend via directives/votes.

```
            ┌──────────────── one agent per project ────────────────┐
 treasury → │  wake (cron or funding event)                          │
  funded?   │   ├─ read mandate + open directives/votes (Supabase)   │
            │   ├─ pick next task within budget + category caps      │
            │   ├─ act via tools:                                    │
            │   │    • code    → sandbox → test → PR → deploy         │
            │   │    • email   → send / poll inbox → route replies    │
            │   │    • social  → draft → post (or escalate)          │
            │   │    • rewards → claim → treasury (withdrawals gated) │
            │   ├─ out-of-mandate / irreversible? → ESCALATE         │
            │   ├─ stream actions → console feed (Realtime)          │
            │   └─ write daily summary (honest "no ships" too)       │
            └────────────────────────────────────────────────────────┘
                       │ escalation
                       ▼
        Founder (console / email / Telegram)  ──inactive N h──▶  DAO vote
```

The escalation ladder is already designed in [the docs](../components/docs/DocsPage.tsx)
and rendered by `AgentConsole`. The runtime just needs to **write escalation
rows** and **block on their resolution**.

**Who steers, with which token.** Steering is **two-token**:

- **Project token** governs *that* project. A holder submits a directive by
  staking project tokens (skin in the game + anti-spam), then it goes to a
  token-weighted vote; on quorum the runtime applies it on the next cycle.
- **$LOOP** governs the *platform* layer: it sets the default compute tier,
  adds cross-project vote weight, and unlocks priority allocation / premium
  analytics.

The **Founder Stake** (1,000+ LOOP locked at launch) is a permanent,
**transferable** bond — it is *never* refunded by deletion (an on-chain
project can't be deleted) and is **reclaimable by the project DAO** if the
founder abandons it. The runtime reads the current Founder address (the stake
holder, via `lib/stake.ts`) to authorize founder-level directives, and treats a
DAO-reclaim vote as a change of that address.

---

## 2. Recommended stack

| Concern | Recommendation | Why |
|---|---|---|
| **Agent brain** | **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) | Tool use, MCP, subagents, the same loop Claude Code runs. Model picked from the stake tier (Haiku/Sonnet/Opus). |
| **Orchestration** | **Trigger.dev** (or Inngest) | Durable cron + steps + retries + observability. Each cycle is a run; survives restarts; scales to zero between cycles. |
| **Code execution / deploy** | **E2B** (or Daytona) sandbox per cycle + **GitHub** + **Vercel** APIs | Isolated env to clone → edit → test → open PR → deploy. Never run project code in the orchestrator. |
| **State** | **Supabase** (already wired) | Tasks, escalations, emails, social posts, daily summaries, action log. Realtime → live console feed. |
| **Email** | **Cloudflare Email Routing** (free catch-all → Worker) or **Postmark** inbound | Real `<slug>@agents.loop.fun` mailbox. Send via Resend/Postmark/SES; inbound webhook → `agent_emails` table → Inbox panel + console. |
| **Social** | **Farcaster + Telegram** first; **X/Twitter** as founder-connected OAuth (paid) | Farcaster/Telegram are automation-friendly and crypto-native. X API is paid and **does not allow programmatic account creation** (see §5). |
| **Agent wallet / custody** | **Turnkey** or **Privy** server wallets | Policy-controlled keys, no raw secrets. Claims rewards → treasury; transfers are guardrailed. |
| **Secrets** | Per-project, KMS-backed; `service_role` for trusted Supabase writes | The launch insert + agent writes must run server-side only. |

**One-line summary:** *Trigger.dev schedules a Claude Agent SDK run per project;
the run works in an E2B sandbox, reads/writes Supabase, sends email via
Cloudflare/Postmark, posts to Farcaster/Telegram, and escalates to the console
when it hits its mandate's edge.*

---

## 3. How each seam function goes live

The seam is already factored so this is a function-body swap, not a rewrite.

| Seam (today, simulated) | Live source |
|---|---|
| `lib/agent.ts › seedTasks` | `agent_tasks` table, written by the runtime's planner |
| `lib/agent.ts › seedInbox` | `agent_emails` table, fed by the inbound email webhook |
| `lib/agent.ts › seedSocial` | `agent_posts` table, written after each successful post |
| `lib/agent.ts › businessStats` | analytics (Plausible/PostHog) + email/post counts |
| `lib/console.ts › seedFeed` / `ACTION_POOL` | Supabase Realtime stream of the agent's action log |
| `lib/console.ts › ESCALATION_POOL` | `agent_escalations` table (open/resolved) |
| `AgentConsole` directive submit | `directives` table → runtime picks up on next cycle |

New tables (sketch): `agent_tasks`, `agent_emails`, `agent_posts`,
`agent_escalations`, `agent_actions`, `directives`, `daily_summaries` — all
RLS-guarded, written by `service_role` only, readable per the existing project
visibility rules.

---

## 4. Email — concretely

This is fully real and not expensive:

1. Point a domain's MX at the provider (need a real domain — **buy `loop.fun`**;
   the app is on a Vercel subdomain today).
2. **Cloudflare Email Routing** (free): catch-all `*@agents.loop.fun` → Worker →
   `POST /api/agent/email/inbound` → insert into `agent_emails`.
3. Sending: **Resend** or **Postmark** with a per-project `from` of
   `<slug>@agents.loop.fun`. Set **SPF / DKIM / DMARC** or it lands in spam.
4. Replies surface in the **Inbox** panel and notify the founder via the console;
   the agent may auto-reply only within its mandate, else it escalates.

---

## 5. Social — the honest version

- **Do not auto-create Twitter/X accounts.** It violates X's ToS, is bot-flagged
  fast, and will get the platform account banned. This is the single most
  common false expectation — Polsia's "@polsia" is a *human-created* account the
  agent *posts to*, not one it spawned.
- **X/Twitter posting** is possible but **paid** (Basic tier ~$200/mo) and via
  **OAuth2 user tokens** the founder connects once. Offer it as a **$LOOP-boosted
  premium**, not a default.
- **Default to Farcaster + Telegram**: open APIs, automation-friendly,
  crypto-native audience. A project's agent can post to a Farcaster channel and a
  Telegram group from day one with no approval gauntlet.
- **Reddit** works for outreach but is rate-limited and community-moderated —
  keep it mandate-gated (drafts escalate before posting), exactly like Polsia
  found (its outreach stalled because posting needs judgment).
- **Telegram build-update bot (read-only).** Beyond a posting channel, each
  project gets a dedicated **read-only** bot `@<slug>_loop_bot` (`lib/telegram.ts`)
  that broadcasts build progress — shipped tasks, commits, treasury delta — so a
  holder can follow along without interacting. The MarkdownV2 formatter
  (`buildUpdateMessage`) is already built and tested; going live is a thin
  `sendMessage` wrapper gated on a founder-provisioned `TELEGRAM_BOT_TOKEN`.

---

## 6. Treasury-gated compute (already half-real)

- **Stake → model tier** is in the mandate (`defaultMandate`): 1,000 → Haiku,
  5,000 → Sonnet, 25,000 → Opus. The runtime reads the on-chain stake
  (`lib/stake.ts`) to pick the model.
- **Treasury balance → cadence + per-cycle token budget.** Empty treasury ⇒ the
  agent sleeps — this is the literal "builds it while the treasury is funded"
  promise. Balance is already live via Helius (`lib/solana.ts`).
- Spend is **metered server-side** against the budget; the agent cannot exceed
  it even if prompted to.

---

## 7. Guardrails (non-negotiable for mainnet)

- Spend caps enforced in code, not just in the prompt.
- **Irreversible actions always escalate**: treasury withdrawals, key/account
  changes, public commitments, anything touching real money or identity.
- Per-project isolation: separate sandbox, separate credentials, separate wallet.
- Every tool call logged and auditable (the action feed is the user-facing slice).
- `service_role` confined to server actions / the runtime; anon can never write
  agent state (mirrors the hardened RLS already in place for `projects`).

---

## 8. Rollout to mainnet

- **Phase 0 — done.** Simulated seam; live treasury (Helius), live project rows
  (Supabase), launch flow + signature proof + vanity mint pool.
- **Phase 1 — dogfood LOOP.** One real agent for the LOOP project itself:
  Claude Agent SDK + GitHub/Vercel deploy + email inbox + Farcaster, escalating
  to the founder console. Lowest risk: we own the repo and the consequences.
- **Phase 2 — devnet projects.** New launches get an auto-provisioned agent on
  devnet, manual approval, capped budgets.
- **Phase 3 — mainnet.** Real mint + on-chain stake lock (partly built:
  `lib/mint-spl.ts`, `lib/stake.ts`, vanity pool) + agent provisioned per project
  at launch. Custody via Turnkey/Privy.

---

## 9. Decisions that need the founder (blockers I can't self-serve)

1. **Domain** — buy `loop.fun` (or pick the agent-email domain). Needed for real
   email + branded agent identities.
2. **Email provider** — Cloudflare Email Routing (free) vs Postmark/Resend.
3. **Orchestration + sandbox** — Trigger.dev vs Inngest; E2B account.
4. **Anthropic API key** for the Agent SDK (separate from this Claude Code key),
   with a spend budget per agent.
5. **Social strategy** — confirm Farcaster + Telegram default, X as paid opt-in.
6. **Wallet custody** — Turnkey vs Privy server wallets.
7. **`SUPABASE_SERVICE_ROLE_KEY`** in Vercel — still pending; unblocks trusted
   writes for both launches and agent state.

Everything above the line (the seam, the UI, the tables, the webhooks, the
runtime skeleton) I can build incrementally against the simulated seam. The
items in §9 are accounts/keys/budget only the founder can provision.
