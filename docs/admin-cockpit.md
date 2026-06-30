# Admin cockpit — projects · agent · treasury

The build spec for turning `/admin` into the founder's operations cockpit. Guiding
principle: **almost every lever already exists in the backend** — they're just
trapped in global env vars and CLI scripts only the maintainer can run. This work
surfaces those levers in the founder-signed admin UI, plus a zero-defect guarantee
for new projects. All actions are gated by the existing founder-wallet session;
treasury actions are **preview-then-confirm** and never expose a secret.

Status legend: ✅ shipped · 🚧 in progress · ⬜ planned.

---

## A. Agent → Founder channel ("Waiting on you")

Today `agent_escalations` (status `open`) only carries *decisions to approve/decline*
(surfaced in the admin "Waiting on you" panel). Extend it into a **typed request
queue** the agent raises when it needs the founder:

| Type | Example | Founder response |
|---|---|---|
| `credential` | "I need API key X / token Y" | input → written to `project_secrets` (encrypted) |
| `action` | "submit the domain to Blowfish" / "fund the agent wallet" | **Done** button |
| `decision` | out-of-mandate (exists today) | Adopt / Decline |
| `info` | "what's the official X account?" | free-text → read by the agent next tick |

Auto-raised from existing signals: repeated fee-claim failure (`shouldEscalateClaim`
already exists, `lib/creator-fees.ts`), missing credential at provisioning, low
treasury/compute, out-of-mandate action.

Backend: add `kind` + `response` + `resolved_at` columns to `agent_escalations`; an
admin API action to resolve (write the answer where the agent reads it next tick).

---

## B. Project lifecycle & zero-defect provisioning

1. **Prelaunch board fix** — the admin still lists drafts whose `status="launched"`
   (the Buildtopia duplicate). Data is correct (`launch_waitlist.status` +
   `project_key` are set); the UI must filter launched drafts out of the actionable
   prelaunch section and show them only as "→ <key> ✓".
2. **Provisioning checklist** per project — green/red per brick with a
   *provision/retry* button. Bricks (from `lib/provisioning.ts` / `lib/agent-readiness.ts`):
   `repo` · `Vercel project + public deploy` · `treasury wallet` · `agent wallet` ·
   `API key (BYO or default)` · `fee_creator_wallet` · `mint` · `first successful tick`.
   A project isn't "live" until all green — surfaces known gaps (e.g. empty
   `VERCEL_TOKEN` = provisioning unarmed) **before** a project launches half-broken.
3. **Pre-launch dry-run** — validate the whole checklist **before** spending the seed
   dev-buy.

---

## C. Treasury & fees

All functions exist; wire them into a panel + buttons.

- **View** per project: treasury SOL (live) · agent-wallet balance · earned / claimable
  / claimed by role (founder/agent/platform, from `lib/fee-ledger.ts`) · last claim.
- **Claim pump.fun creator fees** (per project / all) → `collectCreatorFees`.
- **Verify split** — preview `attributeClaim` / `planFeeDistribution` (who gets what)
  **before** executing.
- **Distribute** → `executeFeeDistribution` (armed-gated) · **Sweep** agent wallet →
  treasury · **Diagnostics** → `diag-treasury`.
- **Reconciliation** — claimable vs claimed, flag drift.

Risk posture: every treasury action is confirm-gated, armed-gated, preview-first; no
private key ever rendered.

---

## D. Ops cockpit (Lot 1)

- Health row per project: treasury SOL · compute $ remaining · last tick · todo/building
  counts · runway.
- **Stuck-task panel** — `building` tasks with age + buttons *mark shipped / requeue /
  reconcile-vs-repo*. Backend engine = the durable reconcile fix (below). Resolves the
  recurring phantom-`building` leak.
- **Backlog manager** — ranked `todo` queue + set priority / add / remove / "build next"
  (curate-backlog logic in the UI; `lib/agent-backlog.ts`).
- **Force-tick** + **sync funding** per project.

### Durable reconcile fix (backend engine for the stuck-task panel)

Root cause found in audit: `landedBuildingTitles` (the building→shipped self-heal) is
only called in the **legacy** brain (`lib/agent-runtime.ts`), never in the live **SDK**
path (`enqueueSdkSession` / cron SDK branch). So when a session's finish callback is
missed (timeout / push race / parse miss), the task leaks as `building` forever — no
reconcile, no reaper. Evidence: 7 tasks stuck up to 12h, all with work already on main.

Fix:
- Reconcile in the SDK path: per funded project each fire, `getRecentCommits(p.repo)` →
  `landedBuildingTitles` → mark shipped.
- Looser match so reworded landings reconcile (e.g. "Build **the** Loop hero" vs commit
  "Build Loop hero").
- Stale reaper: `building` older than a generous threshold (≫ max session wall) and not
  landed → honest non-building state (no phantom rebuild).
- One-time cleanup of the current 7 (all verified landed → shipped).

---

## E. Spend & runtime controls (per project)

- Compute: consumed / credited / **remaining $** · credit / **cap** · toggle
  *budget-gate* + *saver (+floor)* · cadence/cooldown/model/max-turns — **per project**.

### Cross-cutting backend: `project_config`

B, C, E need settings to move from **global env → per-project**. A small `project_config`
table read with **fallback to the current env var** unlocks all of it without breaking
anything that exists today.

---

## Build order

| Lot | Contents | Why |
|---|---|---|
| 1 | Ops cockpit (D) + prelaunch board fix (B.1) + the 2 shipped bug fixes | High impact, ~80% UI over existing backend, resolves the task leak |
| 2 | Treasury & fees (C) | The money — preview-then-confirm |
| 3 | Agent→Founder channel (A) | Needs a small `agent_escalations` schema extension |
| 4 | Zero-defect provisioning checklist (B.2/B.3) | Hardens future launches |
| 5 | `project_config` + spend/runtime controls (E) | The cross-cutting chore, last |

---

## Already shipped this effort

- ✅ Admin project logo fix — was rendering `cover` (a theme key like `"neon"`, not a
  URL); now renders `tokenImageUrl` with an `onError` hide (no broken-image icon).
- ✅ Double-`$` ticker fix — launched tickers are stored with `$`; added the idempotent
  `cashtag()` helper (`lib/format.ts`, tested) applied in admin + profile.
