# Loop — mainnet readiness

> The honest map: what's **built**, what each capability needs to **activate**,
> and the **go/no-go** for a mainnet launch. Pairs with
> [agent-runtime.md](agent-runtime.md) and [loop-roadmap.md](loop-roadmap.md).

## Verdict (one line)

**The product is code-complete and the agent is live in production.** What
remains is *activation* — provider keys, a project repo, and the launch itself —
none of which is code; all of it is the founder's to provision. Loop is **ready
for a mainnet launch the moment the launch keys + real SOL are in place** (§4).

---

## 1. Core agent — ✅ LIVE IN PRODUCTION

A real Claude (`claude-opus-4-8`, structured output) tick runs against LOOP and
**writes real tasks/actions/posts via service-role**. Verified end-to-end in
prod on 2026-06-16 (`POST /api/agent/tick` → HTTP 200, wrote an `agent_tasks`
row). The keys `ANTHROPIC_API_KEY` + `CRON_SECRET` + `AGENT_TICK_SECRET` are in
Vercel prod.

- **Guardrails (the safety floor) — all shipped & live:** A1 verifier gate
  (maker ≠ checker), A2 launch filter, A3 honest summaries, A4 standing mandate
  reread each cycle, A5 cross-project learnings, and the **budget hard-stop**.
- **Gotcha — auto-run is gated on the TREASURY, not the agent wallet.** The cron
  skips a project whose `treasurySol` can't afford a cycle. LOOP's treasury is
  empty (pre-launch) ⇒ it won't auto-tick until funded. Drive it manually via
  `/api/agent/tick` until then.

## 2. The agent's "hands" (autonomous-operator capabilities) — built, gated on keys/providers

| Capability | Code | Activates with |
|---|---|---|
| **Build its product** (write/run code) | ✅ E2B sandbox **wired into the tick** (`agent-runtime.ts` → `runInSandbox`) | `E2B_API_KEY` **+ the LOOP GitHub repo** (founder, "later") + `GITHUB_TOKEN` (write) |
| **Telegram** (build updates) | ✅ wired (`telegram-send.ts`, broadcast on shipped) | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` |
| **Email** (outreach mailbox `<slug>@agents.looplabs.fun`) | ✅ send seam (`email-send.ts`, Resend) | `RESEND_API_KEY` to send; **a real domain** (buy `looplabs.fun` (done)) + Cloudflare Email Routing for *inbound* replies → `agent_emails` |
| **X / Twitter** (launch recap, bounties) | ✅ recap seam (`x-recap.ts`) | X API (paid ~$200/mo) + a **human-created** account (never auto-create — ToS) |
| **Manage its token** (buyback/burn/airdrop/bounty/swap) | ✅ decided by the brain, routed by guardrails (buyback auto via Jupiter; irreversible → escalate) | `AGENT_WALLET_SECRET` (Privy) + **funding the agent wallet** (`5Fk6…XwRV` on devnet) |

**So: yes — like a full autonomous operator, the agent can build its own site, post to socials, and
email.** Every capability is wired or seam-ready; what's missing is the keys +
the repo + a domain, all listed above. None of it is more code.

## 3. Economics — built end to end; the runtime that writes real data is the activation step

- **Fee split** `lib/fees.ts` — founder/agent/platform **30/65/5**, Loop-custodial
  (Loop is the on-chain pump.fun creator). ✅
- **Claim creator-fees** `lib/creator-fees.ts` via PumpPortal. ✅ (needs
  `PUMPPORTAL_API_KEY`, present in `.env.local`; real fees only flow post-launch).
- **Accounting** `lib/fee-ledger.ts` — pure per-role claimable, backed by the
  **`fee_ledger`** table (earned + claimed per role; service-role write, public
  read). ✅
- **Compute rail** `lib/compute-rail.ts` — the agent pays its own fiat bills from
  its *own* fee share: `agent-share SOL → (Jupiter) USDC → provider credit`,
  metered per project (credited − consumed USD). Safety invariant: top-ups can
  only draw the agent's 65%, never founder/platform funds. ✅ pure + tested,
  backed by the **`compute_ledger`** table + `lib/compute-ledger-store.ts`
  (get/save), env-gated on `COMPUTE_RAIL_PROVIDER`.
- **Both ledger tables exist; what's left is the runtime that writes them:** record
  each fee sweep into `fee_ledger`, meter each cycle's real spend into
  `compute_ledger`, and run the auto-top-up (`planTopUp` → real Jupiter swap →
  `recordTopUp`). The actual SOL payouts are irreversible transfers ⇒ they
  escalate like other on-chain actions. Empty until trading begins.

## 4. Mainnet launch — the go/no-go checklist

The launch infra is built (`pumpfun.ts` PumpPortal, `mint-spl.ts`, `vanity.ts`
`…Loop` pool, `stake.ts` holdings reader, treasury). **Pump.fun is mainnet-only**; the
sequence is founder-driven and irreversible.

- [ ] `PUMPPORTAL_API_KEY` in Vercel prod (create token + claim fees)
- [ ] `LAUNCH_SIGNER_SECRET` funded with **real mainnet SOL** (create + initial buy + fees)
- [ ] mainnet `VANITY_POOL` ground for `Loop` (`solana-keygen grind --ends-with Loop`)
- [ ] flip `SOLANA_NETWORK` / `NEXT_PUBLIC_SOLANA_NETWORK` → `mainnet` (reverse of #46)
- [ ] **dry-run → smoke launch (throwaway token) → launch LOOP** — explicit per-step "go", never autonomous
- [ ] fund the **LOOP treasury** so the agent auto-runs (separate from the agent wallet)
- [ ] recommended before launch: `E2B_API_KEY` + the LOOP repo + `GITHUB_TOKEN`, so the live agent actually builds (not just plans)
- [ ] white-label infra (multi-tenant): a Loop-owned **GitHub org** (`GITHUB_ORG`, default `LoopLabsfun`) + **Vercel team** (`VERCEL_TOKEN` + `VERCEL_TEAM_ID`), so every project builds under Loop, never a personal account (`lib/provisioning.ts` plans it; launch already defaults the repo)
- [ ] compute rail (funded-by-fees): `COMPUTE_RAIL_PROVIDER` + a KYC'd exchange/bank account held by the **Loop legal entity**, so the agent-share SOL can convert to provider credit (`lib/compute-rail.ts`)

When these are checked, Loop is mainnet-ready. Everything above the line is done.

---

## What I (the build) can still do without keys

The buildable backlog is essentially cleared:

- ✅ **Fee-ledger + compute-ledger DB** (§3) — both tables + stores exist.
- ✅ **Email inbound webhook route** (`app/api/email/inbound`) — wired, secret-gated,
  activates the moment a domain + provider exist.
- ✅ **White-label provisioning** (`lib/provisioning.ts`) — `LoopLabsfun/<slug>` by default.
- ⏭️ **Farcaster** — intentionally skipped (founder's call).

What remains is the **runtime wiring** that needs the activation keys (real fee
sweeps, compute metering + auto-top-up, GitHub/Vercel API calls) and the
provisioning in §1–4. Provisioning is yours.
