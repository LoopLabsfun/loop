// Pure, dependency-free helper that sums how much SOL the agent has actually
// committed in a rolling 24h window. This is the 'spent' input that pairs with
// budgetStatusFromPolicy(): the policy supplies the cap (maxDailySol) and this
// supplies the spent figure — both derived from the SAME accounting rule the
// guardrail uses, namely only EXECUTED actions count toward the daily limit.
//
// Simulated/escalated/blocked actions never moved funds, so they must not
// inflate the spent total; if they did, the transparency view would disagree
// with the live guardrail (evaluateAction's spentTodaySol).

/** A record of an attempted agent action, as logged by the exec layer. */
export interface ActionRecord {
  /** SOL committed by this action (buyback/bounty/swap-in). */
  amountSol?: number;
  /** Whether the action was actually executed on-chain (signed + submitted). */
  executed?: boolean;
  /** When it executed — epoch ms, or anything Date can parse (ISO string). */
  executedAt?: number | string | Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toEpochMs(value: number | string | Date | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function sanitizeSol(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * Sum the SOL committed by EXECUTED actions whose executedAt falls within the
 * rolling window ending at `now` (default: the last 24h).
 *
 * Rules:
 * - only records with `executed === true` count (matches the guardrail);
 * - records with a missing/unparseable timestamp are excluded (can't be placed
 *   in the window);
 * - records older than the window or in the future are excluded;
 * - negative / NaN amounts are treated as 0.
 *
 * The returned total is always a finite, non-negative number.
 */
export function spentTodaySol(
  records: readonly ActionRecord[] | null | undefined,
  now: number = Date.now(),
  windowMs: number = DAY_MS
): number {
  if (!Array.isArray(records) || records.length === 0) return 0;
  const end = Number.isFinite(now) ? now : Date.now();
  const span = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DAY_MS;
  const start = end - span;

  let total = 0;
  for (const r of records) {
    if (!r || r.executed !== true) continue;
    const ts = toEpochMs(r.executedAt);
    if (ts === null) continue;
    if (ts < start || ts > end) continue;
    total += sanitizeSol(r.amountSol);
  }
  return total;
}
