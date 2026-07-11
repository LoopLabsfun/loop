// ─────────────────────────────────────────────────────────────────────────────
// ROI PER TICK — measure whether shipped work moved anything real.
//
// The runtime meters what a tick COSTS (compute_ledger) but never what it was
// WORTH — so cadence/effort knobs and the ALTITUDE busywork flag ran on
// estimation alone. This closes the loop: when a task ships, the finish route
// stores a snapshot of the project's vitals (treasury SOL, market cap, 24h
// volume); once its J+7 window elapses, the cron reconciles the snapshot
// against the CURRENT vitals into a 0..100 impact score persisted on the task
// and appended to its outcome (episodic memory — so recall and the next
// decision see "what this kind of work actually did").
//
// Honesty note, by design: attribution is naive — the deltas are whole-project
// movements over a window shared by every ship inside it (and by the market's
// own noise). That is good enough for what the score is FOR: separating
// "nothing happened" from "the needle moved", in aggregate, per category —
// not judging a single commit. Pure math here; IO is bounded + best-effort.
// ─────────────────────────────────────────────────────────────────────────────

import type { Project } from "./types";

/** Vitals captured the moment a task shipped (all best-effort readings). */
export interface ShipSnapshot {
  /** Live treasury balance at ship, SOL. */
  treasurySol: number | null;
  /** Display market cap at ship, e.g. "$30K" (parsed for the delta). */
  marketCap: string | null;
  /** Display 24h volume at ship, e.g. "$1.2K" / "12.3 SOL". */
  volume24h: string | null;
  /** ISO timestamp of the ship. */
  at: string;
}

/** Days a snapshot must age before reconciliation. */
export const IMPACT_WINDOW_DAYS = 7;

/** Pure: the snapshot to store when a task ships. */
export function buildShipSnapshot(
  p: Pick<Project, "treasurySol" | "marketCap" | "volume24h">,
  now: Date = new Date()
): ShipSnapshot {
  return {
    treasurySol:
      typeof p.treasurySol === "number" && Number.isFinite(p.treasurySol)
        ? p.treasurySol
        : null,
    marketCap: p.marketCap || null,
    volume24h: p.volume24h || null,
    at: now.toISOString(),
  };
}

/**
 * Pure: parse a short display amount ("$30K", "$2.4M", "$1,200", "12.3 SOL")
 * into a number in its own unit, or null for placeholders ("—", ""). Commas are
 * thousands separators (the app's display formats are US-style). Unit is NOT
 * normalized — callers only ever compare like with like.
 */
export function parseShortAmount(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /(-?\d+(?:\.\d+)?)\s*([kmb])?/i.exec(s.replace(/[$,]/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? "").toLowerCase() as "k" | "m" | "b"] ?? 1;
  return n * mult;
}

/** Growth needed for full points on a signal (50% over the window = max). */
const FULL_GROWTH = 0.5;

const growthPoints = (
  before: number | null,
  after: number | null,
  maxPts: number
): number | null => {
  if (before == null || after == null || before <= 0) return null;
  const pct = (after - before) / before;
  if (pct <= 0) return 0; // decline reads as "no lift", never as negative blame
  return Math.round(maxPts * Math.min(1, pct / FULL_GROWTH));
};

/**
 * Pure: the J+7 impact score, 0..100, or null when there is NO comparable
 * signal (both sides missing) — null means "don't write a junk score".
 *   +10 baseline (it shipped and survived the window),
 *   +45 max for market-cap growth, +45 max for treasury growth,
 *   each scaled linearly to +50% growth. Declines score 0 lift, not negative:
 *   a single task never takes the blame for whole-market noise.
 */
export function impactScore(
  snapshot: Pick<ShipSnapshot, "treasurySol" | "marketCap">,
  current: { treasurySol: number | null; marketCap: string | null }
): number | null {
  const mcap = growthPoints(
    parseShortAmount(snapshot.marketCap),
    parseShortAmount(current.marketCap),
    45
  );
  const treasury = growthPoints(snapshot.treasurySol, current.treasurySol, 45);
  if (mcap == null && treasury == null) return null;
  return Math.max(0, Math.min(100, 10 + (mcap ?? 0) + (treasury ?? 0)));
}

/** Pure: the outcome-line suffix persisted into episodic memory. */
export function impactOutcomeNote(score: number): string {
  const read =
    score >= 60 ? "the needle moved" : score >= 25 ? "some lift" : "no visible lift";
  return `IMPACT J+${IMPACT_WINDOW_DAYS}: ${score}/100 (${read})`;
}

/**
 * IO: persist the ship snapshot onto the task row that just shipped (matched by
 * project + title, newest first). Called from the session-finish route right
 * after a verified push. Best-effort: a miss must never affect the persist.
 */
export async function recordShipSnapshot(
  p: Project,
  taskTitle: string
): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("./supabase");
    if (!supabaseAdmin) return false;
    const { data } = await supabaseAdmin
      .from("agent_tasks")
      .select("id")
      .eq("project_key", p.key)
      .eq("title", taskTitle)
      .eq("status", "shipped")
      .is("ship_snapshot", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const id = (data as { id: number } | null)?.id;
    if (!id) return false;
    const { error } = await supabaseAdmin
      .from("agent_tasks")
      .update({ ship_snapshot: buildShipSnapshot(p) })
      .eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

/**
 * IO: reconcile up to `max` of this project's aged snapshots (J+7 elapsed,
 * not yet scored) against its CURRENT vitals. Persists impact_score/impact_at
 * and appends the impact note to last_outcome so the episodic layer (recall,
 * next decisions, ALTITUDE) sees what the work actually did. Returns the
 * number reconciled; best-effort throughout.
 */
export async function reconcileImpactScores(p: Project, max = 5): Promise<number> {
  try {
    const { supabaseAdmin } = await import("./supabase");
    if (!supabaseAdmin) return 0;
    const cutoff = new Date(
      Date.now() - IMPACT_WINDOW_DAYS * 86_400_000
    ).toISOString();
    const { data } = await supabaseAdmin
      .from("agent_tasks")
      .select("id, ship_snapshot, last_outcome")
      .eq("project_key", p.key)
      .eq("status", "shipped")
      .not("ship_snapshot", "is", null)
      .is("impact_at", null)
      .lte("updated_at", cutoff)
      .order("updated_at", { ascending: true })
      .limit(max);
    const rows =
      (data as { id: number; ship_snapshot: ShipSnapshot; last_outcome: string | null }[] | null) ??
      [];
    let done = 0;
    for (const r of rows) {
      const score = impactScore(r.ship_snapshot, {
        treasurySol: Number.isFinite(p.treasurySol) ? p.treasurySol : null,
        marketCap: p.marketCap || null,
      });
      // No comparable signal: stamp impact_at so the row isn't rescanned forever.
      const note = score == null ? null : impactOutcomeNote(score);
      const outcome = note
        ? `${r.last_outcome ? `${r.last_outcome} · ` : ""}${note}`.slice(0, 400)
        : r.last_outcome;
      const { error } = await supabaseAdmin
        .from("agent_tasks")
        .update({
          impact_score: score,
          impact_at: new Date().toISOString(),
          last_outcome: outcome,
        })
        .eq("id", r.id);
      if (!error) done++;
    }
    return done;
  } catch {
    return 0;
  }
}
