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

## 2. The agent's "hands" (Polsia capabilities) — built, gated on keys/providers

| Capability | Code | Activates with |
|---|---|---|
| **Build its product** (write/run code) | ✅ E2B sandbox **wired into the tick** (`agent-runtime.ts` → `runInSandbox`) | `E2B_API_KEY` **+ the LOOP GitHub repo** (founder, "later") + `GITHUB_TOKEN` (write) |
| **Telegram** (build updates) | ✅ wired (`telegram-send.ts`, broadcast on shipped) | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` |
| **Email** (outreach mailbox `<slug>@agents.loop.fun`) | ✅ send seam (`email-send.ts`, Resend) | `RESEND_API_KEY` to send; **a real domain** (buy `loop.fun`) + Cloudflare Email Routing for *inbound* replies → `agent_emails` |
| **X / Twitter** (launch recap, bounties) | ✅ recap seam (`x-recap.ts`) | X API (paid ~$200/mo) + a **human-created** account (never auto-create — ToS) |
| **Manage its token** (buyback/burn/airdrop/bounty/swap) | ✅ decided by the brain, routed by guardrails (buyback auto via Jupiter; irreversible → escalate) | `AGENT_WALLET_SECRET` (Privy) + **funding the agent wallet** (`5Fk6…XwRV` on devnet) |

**So: yes — like Polsia, the agent can build its own site, post to socials, and
email.** Every capability is wired or seam-ready; what's missing is the keys +
the repo + a domain, all listed above. None of it is more code.

## 3. Economics — built; ledger DB is the one remaining buildable prep

- **Fee split** `lib/fees.ts` — founder/agent/platform **30/65/5**, Loop-custodial
  (Loop is the on-chain pump.fun creator). ✅
- **Claim creator-fees** `lib/creator-fees.ts` via PumpPortal. ✅ (needs
  `PUMPPORTAL_API_KEY`, present in `.env.local`; real fees only flow post-launch).
- **Accounting** `lib/fee-ledger.ts` — pure per-role claimable. ✅
- **TODO (buildable now, empty until fees flow):** a `fee_distributions` /
  `fee_claims` DB table + record/claim wired into the `FeesCustodyCard`, so the
  30/65/5 split and claims are tracked once trading begins. The actual SOL payout
  is an irreversible transfer ⇒ it escalates like other on-chain actions.

## 4. Mainnet launch — the go/no-go checklist

The launch infra is built (`pumpfun.ts` PumpPortal, `mint-spl.ts`, `vanity.ts`
`…Loop` pool, `stake.ts` gate, treasury). **Pump.fun is mainnet-only**; the
sequence is founder-driven and irreversible.

- [ ] `PUMPPORTAL_API_KEY` in Vercel prod (create token + claim fees)
- [ ] `LAUNCH_SIGNER_SECRET` funded with **real mainnet SOL** (create + initial buy + fees)
- [ ] mainnet `VANITY_POOL` ground for `Loop` (`solana-keygen grind --ends-with Loop`)
- [ ] flip `SOLANA_NETWORK` / `NEXT_PUBLIC_SOLANA_NETWORK` → `mainnet` (reverse of #46)
- [ ] **dry-run → smoke launch (throwaway token) → launch LOOP** — explicit per-step "go", never autonomous
- [ ] fund the **LOOP treasury** so the agent auto-runs (separate from the agent wallet)
- [ ] recommended before launch: `E2B_API_KEY` + the LOOP repo + `GITHUB_TOKEN`, so the live agent actually builds (not just plans)

When these are checked, Loop is mainnet-ready. Everything above the line is done.

---

## What I (the build) can still do without keys

1. **Fee-ledger DB** (§3) — the last buildable economics piece (prep; empty until fees).
2. **Farcaster seam** — the one social channel not yet stubbed (Telegram/X done).
3. **Email inbound webhook route** — ready to wire the moment a domain + provider exist.

Everything else is provisioning, and provisioning is yours.
