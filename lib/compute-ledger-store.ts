import "server-only";

import { supabase, supabaseAdmin } from "./supabase";
import { ZERO_LEDGER, type ComputeLedger } from "./compute-rail";

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTE LEDGER STORE — persistence for the compute rail (lib/compute-rail.ts).
//
// The pure module computes balances over an in-memory ComputeLedger; this reads
// and writes the per-project running totals in the `compute_ledger` table
// (credited_usd + consumed_usd). Public read (anon client), service-role write —
// the same posture as fee_ledger. The runtime calls `save` after metering a
// cycle's spend or topping up credit; the UI/runtime calls `get` to read balance.
//
// Server-only (writes need the service-role key). Falls back to ZERO_LEDGER when
// Supabase is unconfigured or the row is missing, so reads never throw.
// ─────────────────────────────────────────────────────────────────────────────

/** Read a project's compute ledger; ZERO_LEDGER when unconfigured or absent. */
export async function getComputeLedger(projectKey: string): Promise<ComputeLedger> {
  if (!supabase) return ZERO_LEDGER;
  const { data, error } = await supabase
    .from("compute_ledger")
    .select("credited_usd, consumed_usd")
    .eq("project_key", projectKey)
    .maybeSingle();
  if (error || !data) return ZERO_LEDGER;
  const row = data as { credited_usd: unknown; consumed_usd: unknown };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { creditedUsd: num(row.credited_usd), consumedUsd: num(row.consumed_usd) };
}

/**
 * Persist a project's compute ledger (service-role upsert). Clamps the totals
 * non-negative (matching the table's CHECK) so a bad caller can't write garbage.
 * Throws when the service-role key is absent — writes are a privileged path.
 */
export async function saveComputeLedger(
  projectKey: string,
  ledger: ComputeLedger
): Promise<void> {
  if (!supabaseAdmin) {
    throw new Error("saveComputeLedger requires SUPABASE_SERVICE_ROLE_KEY");
  }
  const { error } = await supabaseAdmin.from("compute_ledger").upsert({
    project_key: projectKey,
    credited_usd: Math.max(0, ledger.creditedUsd),
    consumed_usd: Math.max(0, ledger.consumedUsd),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}
