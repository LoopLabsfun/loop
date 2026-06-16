# Loop economics — fees, claiming, the agent wallet

> How a Loop project funds itself: creator fees are split between the **founder**
> (dev share), the project's **agent** (so it self-funds its compute + on-chain
> actions), and **Loop** (platform). "Polsia, but funded by fees."
>
> Decisions on this page are the founder's (2026-06-15): **Loop is the on-chain
> creator (custodial)**, default split **30 / 65 / 5** (founder / agent / Loop),
> agent wallet is a **managed server wallet (Turnkey/Privy)**.

---

## 1. The pump.fun primitive we build on

pump.fun shipped **native creator-fee sharing** (Jan 9 2026): a coin's creator
can route creator fees to **up to 10 wallets** with **assignable percentages**,
transfer ownership, and revoke authority — configurable after launch. Creator
fees run ~**0.95%/trade** (mcap $88k–$300k) down to **0.05%** at $20M, plus
0.05% on PumpSwap post-graduation. Fees are **claimed** from the creator
profile, and there's a **PumpPortal creator-fee API** so claiming can be done
programmatically. Unclaimed fees stay acquired to the assigned wallets.

→ Loop doesn't need a custom on-chain split program. We use pump.fun's native
multi-wallet fee-share to route each project's three shares, and the PumpPortal
API to claim.

Sources: [Brave New Coin](https://bravenewcoin.com/insights/pump-fun-introduces-creator-fee-sharing-system-to-rebalance-platform-incentives),
[CoinMarketCap](https://coinmarketcap.com/academy/article/pumpfun-creators-earn-dollar2m-in-first-day-under-new-fee-structure),
[PumpPortal creator-fee API](https://pumpportal.fun/creator-fee/).

---

## 2. The split (`lib/fees.ts`)

| Role | Default | What it funds |
|---|---:|---|
| **Founder** (dev) | 30% | The founder's reward — **claimable from the Loop UI**. The reason to launch on Loop. |
| **Agent** | 65% | The project's **own agent wallet** — compute/infra **and** on-chain actions (buyback, burn, airdrop, bounty, trades). This is what makes it self-running. |
| **Loop** (platform) | 5% | Keeps the platform sustainable. Fixed. |

- Configurable **per project** at launch; the founder↔agent balance is the
  lever (platform fixed at 5%). `lib/fees.ts` is the pure, tested source of
  truth: `makeSplit`, `isValidSplit`, `distribute` (re-sums to the claimed
  amount exactly — dust lands on the agent's operating account).
- **Never-blocked / runs while funded**: the budget hard-stop (`lib/budget.ts`)
  sleeps a treasury-empty agent; the agent's own fee share refills its wallet on
  every trade → a self-sustaining loop. As long as the coin trades, the agent
  keeps building.

---

## 3. Custody & claiming (the founder's choice: custodial)

**Loop is the on-chain creator.** Loop's launch signer creates the coin, owns
update authority, configures the native fee-share to the three wallets
(founder's wallet, the project's agent wallet, Loop), and claims via PumpPortal.

- **Founder dev-fee claim**: surfaced in the Loop UI → calls the PumpPortal
  creator-fee claim for the founder's share to **the founder's own wallet**.
- **Agent share**: routes to the project's agent wallet automatically; the
  agent claims/uses it to operate.
- **Honest caveat (custodial weight)**: because Loop holds the creator
  authority and the claim flow, Loop is a custodian of the fee stream until each
  party's share lands in their wallet — this carries trust + regulatory weight.
  Mitigations: assign the founder's share to **their own wallet** in the native
  fee-share (so Loop never holds it), publish the split on-chain, and keep a
  migration path to a trustless on-chain split program later.

---

## 4. The agent wallet (Turnkey/Privy managed server wallet)

Each project gets its **own** wallet — a policy-controlled server wallet
(Turnkey or Privy: Loop operates it, policy prevents draining). It receives the
agent's fee share and spends it on, within guardrails + the escalation ladder:

- **Buyback & burn** — supports the token; burns are irreversible → escalate
  above a cap.
- **Airdrops** to holders — reward/retention.
- **Bounties** (pump.fun) — pay contributors.
- **Trades / LP** — treasury management.

All actions are budget-capped, logged (the action feed), and irreversible /
out-of-mandate ones escalate to the founder, then the DAO — same ladder as the
Agent Console.

**Value is on-chain; Loop never custodies fiat.** A project's success accrues to
its **token**, and the agent returns value to holders **on-chain**: **buybacks**,
**airdrops** to holders, and **pump.fun bounties** — all from the agent's fee
share, within the guardrails. Loop holds **no** product-revenue account; the
only fiat touchpoint anywhere is the compute rail (§7), and even there Loop only
fronts against the agent's own crypto earnings.

**Founder-operated product revenue (opt-in, off-Loop).** A founder *may* monetize
the product in fiat through **their own Stripe / their own legal entity** — Loop
never touches it, never custodies it, and is not the payment principal (Polsia-
style: "payouts in *your* Stripe"). Two guardrails keep this aligned with the
holders who funded the token:
- **Transparency** — the project page discloses *whether* it has founder-operated
  off-Loop revenue (vs token-only), so buyers aren't misled.
- **Holder alignment** — the founder is encouraged (via the mandate/governance)
  to commit a **% of product revenue back to the treasury** (→ buybacks/airdrops).
  It's off-chain fiat, so this is a *disclosed commitment*, not on-chain-enforced.

The Loop-native, fully-aligned alternative remains **crypto-native** monetization
(charge in USDC/SOL → straight to the treasury → holders) — recommended where it
fits, since it needs no Stripe and no trust.

---

## 5. Deeper steering (founder + holder)

Beyond mission + budget, the mandate gains **content/policy controls** and
**budget caps** editable by the founder (applied directly) and proposable by
holders (token-staked → weighted vote → adopted), via the existing `directives`
seam. The launch form captures the initial mandate + fee split.

---

## 6. Rollout — how we get to mainnet

- **Phase 0 — now, no keys.** Pure fee model (`lib/fees.ts`, done) → persist the
  per-project split (migration + launch-form config + treasury-card display) →
  show the agent-wallet line (pre-launch: "provisioned at launch"). Honest/devnet.
- **Phase 1 — devnet + keys.** Provision per-project agent wallets (managed
  keypair on devnet, then Turnkey/Privy), run the tick, show the real agent
  balance, test buyback/airdrop on devnet.
- **Phase 2 — mainnet pump.fun.** Launch **LOOP with a `…Loop` CA** via
  PumpPortal → configure the native fee-share (founder + agent + Loop) → wire
  claiming via the PumpPortal creator-fee API → enable the agent's on-chain
  actions. Per-step, explicit founder "go" only (irreversible).

Founder-only blockers stay the same (`ANTHROPIC_API_KEY`, `CRON_SECRET`,
`E2B_API_KEY`, `PUMPPORTAL_API_KEY`, Turnkey/Privy creds, a real domain). See
[agent-runtime.md](agent-runtime.md) and [loop-roadmap.md](loop-roadmap.md).

---

## 7. Multi-tenant: who pays for compute (founder decisions, 2026-06)

When projects are launched by **strangers**, the agent brain still bills in fiat
(Anthropic). An AI agent cannot legally hold a card / pass KYC, so there is
always a human/company principal at the financial root. Locked model:

- **Compute = hybrid graduation.** By default **Loop fronts** each project's
  compute on Loop's provider account, **capped to that project's own agent fee
  share** (the compute rail's invariant — a project can never spend more than it
  earned; no cross-subsidy). A project can **graduate** to its **own** provider/
  GitHub keys when it wants full self-custody. Frictionless onboarding, bounded
  exposure.
- **No fiat product revenue to custody.** Value returns to holders on-chain
  (buybacks / airdrops / bounties) — see §4. Loop never holds strangers' product
  income.
- **Custodial reality.** Because Loop fronts the fiat compute and runs the
  SOL→USDC→provider conversion, Loop is a **custodial platform** for that flow:
  it needs a real **legal entity**, ToS, and (before opening to the public)
  **KYC/AML** — possibly money-services registration depending on jurisdiction.
  This is the main non-code prerequisite for Phase 3.
- **Staged opening.** **Phase A** — LOOP only (the founder is the sole
  principal; zero custody of strangers). **Phase B** — invite-only (bounded
  exposure). **Phase C** — public, only after the legal entity + compliance +
  the graduation/BYO path exist. No license needed on day 1 — needed before the
  public phase.
