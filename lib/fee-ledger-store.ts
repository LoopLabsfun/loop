import "server-only";

import { supabase, supabaseAdmin } from "./supabase";
import {
  ZERO_FEE_LEDGER,
  recordSweep,
  type FeeLedger,
} from "./fee-ledger";
import type { FeeSplit } from "./fees";

export type { FeeLedger } from "./fee-ledger";
export { ZERO_FEE_LEDGER } from "./fee-ledger";

// ─────────────────────────────────────────────────────────────────────────────
// FEE LEDGER STORE — persistence for the creator-fee accounting (lib/fee-ledger.ts).
//
// The pure module computes per-role earned/claimed totals; this reads and writes
// the per-project running totals in the `fee_ledger` table. Public read (anon
// client), service-role write — same posture as compute_ledger. The runtime
// calls `recordSweepToLedger` after a successful pump.fun creator-fee claim so
// the 30/65/5 split is persisted (not just displayed); the UI calls `getFeeLedger`
// to show the real founder-claimable balance.
//
// Server-only (writes need the service-role key). Falls back to ZERO totals when
// Supabase is unconfigured or the row is missing, so reads never throw.
// ─────────────────────────────────────────────────────────────────────────────

interface FeeLedgerRow {
  earned_founder_sol: unknown;
  earned_agent_sol: unknown;
  earned_platform_sol: unknown;
  claimed_founder_sol: unknown;
  claimed_agent_sol: unknown;
  claimed_platform_sol: unknown;
}

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

function rowToLedger(row: FeeLedgerRow): FeeLedger {
  return {
    earned: {
      founderSol: num(row.earned_founder_sol),
      agentSol: num(row.earned_agent_sol),
      platformSol: num(row.earned_platform_sol),
    },
    claimed: {
      founderSol: num(row.claimed_founder_sol),
      agentSol: num(row.claimed_agent_sol),
      platformSol: num(row.claimed_platform_sol),
    },
  };
}

/** Read a project's fee ledger; ZERO_FEE_LEDGER when unconfigured or absent. */
export async function getFeeLedger(projectKey: string): Promise<FeeLedger> {
  if (!supabase) return ZERO_FEE_LEDGER;
  const { data, error } = await supabase
    .from("fee_ledger")
    .select(
      "earned_founder_sol, earned_agent_sol, earned_platform_sol, claimed_founder_sol, claimed_agent_sol, claimed_platform_sol"
    )
    .eq("project_key", projectKey)
    .maybeSingle();
  if (error || !data) return ZERO_FEE_LEDGER;
  return rowToLedger(data as FeeLedgerRow);
}

/**
 * Persist a project's fee ledger (service-role upsert). Clamps non-negative so a
 * bad caller can't write garbage. Throws when the service-role key is absent —
 * writes are a privileged path.
 */
export async function saveFeeLedger(
  projectKey: string,
  ledger: FeeLedger
): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error("saveFeeLedger requires SUPABASE_SERVICE_ROLE_KEY");
  }
  const nn = (n: number) => Math.max(0, n);
  const { error } = await supabaseAdmin.from("fee_ledger").upsert({
    project_key: projectKey,
    earned_founder_sol: nn(ledger.earned.founderSol),
    earned_agent_sol: nn(ledger.earned.agentSol),
    earned_platform_sol: nn(ledger.earned.platformSol),
    claimed_founder_sol: nn(ledger.claimed.founderSol),
    claimed_agent_sol: nn(ledger.claimed.agentSol),
    claimed_platform_sol: nn(ledger.claimed.platformSol),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/**
 * Apply a freshly-swept creator-fee amount to a project's earned totals, split by
 * the project's FeeSplit, and persist. The single call the runtime makes after a
 * successful collectCreatorFees(). Best-effort caller; returns the new ledger so
 * the caller can log the per-role deltas. Throws only on a missing service-role
 * key (a real misconfiguration the caller should surface).
 */
export async function recordSweepToLedger(
  projectKey: string,
  claimedSol: number,
  split: FeeSplit
): Promise<FeeLedger> {
  const current = await getFeeLedger(projectKey);
  const next: FeeLedger = {
    earned: recordSweep(current.earned, claimedSol, split),
    claimed: current.claimed,
  };
  await saveFeeLedger(projectKey, next);
  return next;
}
