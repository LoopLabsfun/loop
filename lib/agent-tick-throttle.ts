// ─────────────────────────────────────────────────────────────────────────────
// AGENT TICK THROTTLE — bound the agent's spend RATE.
//
// The Vercel */2 cron was removed, so GitHub Actions is the SOLE heartbeat, and
// its schedule can't be changed by the agent's token (no `workflow` scope) — it
// fires roughly every 5 min. Each tick can run a brain decision AND enqueue a
// real SDK-in-E2B session, with NO per-session cooldown, so without a rate limit
// the agent drains Claude credit fast (this is what burned the budget twice).
//
// Why a *time* limit and not a $ cap: an individual Anthropic account has no
// usable live-balance API (the Cost API needs an org), and `consumed_usd` in the
// compute ledger isn't metered per tick — so a true $-denominated hard stop
// isn't possible here without building token-usage metering across every call
// site. A deterministic cooldown IS possible and bounds the burn predictably.
// The AGENT_PAUSED kill switch remains the instant, total stop.
//
// Pure (no I/O) so it's unit-testable; the cron pairs `tickCooldownMs()` with
// `isAgentActive(key, cooldownMs)` (lib/agent-data) — the agent writes a task
// row on every tick (and at SDK-session enqueue), so "active within the window"
// is an accurate "ticked recently" signal with no extra state.
// ─────────────────────────────────────────────────────────────────────────────

/** Default minimum gap between expensive agent ticks, minutes. Conservative for
 *  a tight Claude budget — the founder can lower it via AGENT_TICK_COOLDOWN_MIN
 *  once there's more runway (or a real budget gate). */
export const DEFAULT_TICK_COOLDOWN_MIN = 60;

/**
 * Minimum milliseconds between expensive agent ticks. Reads
 * `AGENT_TICK_COOLDOWN_MIN` (minutes): an explicit "0" DISABLES the cooldown;
 * any other non-positive / unparseable value falls back to the conservative
 * default rather than accidentally disabling the guardrail.
 */
export function tickCooldownMs(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env.AGENT_TICK_COOLDOWN_MIN?.trim();
  if (raw === "0") return 0; // explicit opt-out only
  const n = Number(raw);
  const minutes = Number.isFinite(n) && n > 0 ? n : DEFAULT_TICK_COOLDOWN_MIN;
  return Math.round(minutes * 60_000);
}
