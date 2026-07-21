import "server-only";
import { supabase, supabaseAdmin } from "./supabase";

/**
 * Redundant treasury-balance verification — Loop Compute's first job type
 * that needs ZERO Claude/LLM anywhere in its lifecycle (dispatch, execution,
 * OR verification). Every other compute job (lib/device-assists.ts) only
 * exists to feed an agent's LLM prompt; this one is useful standalone: many
 * devices independently read the SAME on-chain balance for the same 5-minute
 * window, and the majority value is truth — the same k-redundancy pattern as
 * lib/compute-consensus.ts, applied to a different (non-agent-task) job.
 *
 * Honesty note on what this does and doesn't prove: v1 devices read via this
 * app's own /api/rpc proxy (the public Solana RPC 403s browser-origin
 * requests — see app/api/rpc/route.ts), so it does NOT yet protect against a
 * compromised/lying proxy — every device would agree on the same bad number.
 * What it DOES catch today: client-side bugs, stale caches, and any device
 * whose read genuinely diverges. Real oracle-grade decentralization needs
 * devices hitting independently-configured RPC endpoints — a v2 concern.
 */

const BUCKET_MS = 5 * 60 * 1000;

/** Floor `ts` to the current 5-minute bucket (ISO string) — the redundancy
 *  window devices are grouped into. Server-computed, never client-trusted. */
export function currentBucket(ts: number = Date.now()): string {
  return new Date(Math.floor(ts / BUCKET_MS) * BUCKET_MS).toISOString();
}

export interface TreasuryCheckInput {
  projectKey: string;
  wallet: string;
  lamports: number;
  deviceId: string;
  deviceName?: string;
  payoutAddress?: string;
  payoutAddressHood?: string;
}

export interface TreasuryCheckRow {
  id: number;
  lamports: number;
  deviceId: string;
  consensusOk: boolean | null;
}

/** Most frequent value, deterministic tiebreak — mirrors
 *  lib/compute-consensus.ts's majority() (numbers here, not hashes). */
function majorityLamports(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestN = 0;
  for (const [v, n] of Array.from(counts.entries()).sort((a, b) => a[0] - b[0])) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** Pure: given every check in a (project, bucket) group, who agrees with
 *  the majority? Redundancy needs ≥2 reports — a lone report is unverified,
 *  not wrong (consensusOk stays null). */
export function consensusForBucket(rows: TreasuryCheckRow[]): { id: number; consensusOk: boolean }[] {
  if (rows.length < 2) return [];
  const consensus = majorityLamports(rows.map((r) => r.lamports));
  return rows.map((r) => ({ id: r.id, consensusOk: r.lamports === consensus }));
}

/**
 * Submit one device's read; recomputes consensus for that (project, bucket)
 * group immediately (cheap — a handful of rows) and persists the verdicts.
 * Returns this submission's own verdict once ≥2 devices have reported.
 */
export async function submitTreasuryCheck(
  input: TreasuryCheckInput
): Promise<{ ok: boolean; consensusOk: boolean | null; reporters: number; error?: string }> {
  if (!supabaseAdmin) return { ok: false, consensusOk: null, reporters: 0, error: "no service role" };
  const bucket = currentBucket();

  const { error: insErr } = await supabaseAdmin.from("treasury_checks").upsert(
    {
      project_key: input.projectKey,
      wallet: input.wallet,
      bucket_ts: bucket,
      lamports: Math.round(input.lamports),
      device_id: input.deviceId.slice(0, 128),
      device_name: input.deviceName?.slice(0, 128) ?? null,
      payout_address: input.payoutAddress?.slice(0, 64) ?? null,
      payout_address_hood: input.payoutAddressHood?.slice(0, 64) ?? null,
    },
    { onConflict: "project_key,bucket_ts,device_id" }
  );
  if (insErr) return { ok: false, consensusOk: null, reporters: 0, error: insErr.message };

  const { data, error: selErr } = await supabaseAdmin
    .from("treasury_checks")
    .select("id, lamports, device_id, consensus_ok")
    .eq("project_key", input.projectKey)
    .eq("bucket_ts", bucket);
  if (selErr || !data) return { ok: true, consensusOk: null, reporters: 1 };

  const rows = data as { id: number; lamports: number; device_id: string; consensus_ok: boolean | null }[];
  const verdicts = consensusForBucket(
    rows.map((r) => ({ id: r.id, lamports: r.lamports, deviceId: r.device_id, consensusOk: r.consensus_ok }))
  );
  if (verdicts.length) {
    await Promise.all(
      verdicts.map((v) =>
        supabaseAdmin!.from("treasury_checks").update({ consensus_ok: v.consensusOk }).eq("id", v.id)
      )
    );
  }
  const mine = verdicts.find((v) => rows.find((r) => r.id === v.id)?.device_id === input.deviceId);
  return { ok: true, consensusOk: mine?.consensusOk ?? null, reporters: rows.length };
}

export interface TreasuryConsensusStats {
  projectKey: string;
  wallet: string;
  latestBucket: string | null;
  reporters: number;
  agreedLamports: number | null;
  dissenters: number;
}

/** Public read: the latest verified bucket for a project, and how many
 *  devices agreed — the "is our data trustworthy" surface. */
export async function getTreasuryConsensus(projectKey: string): Promise<TreasuryConsensusStats | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("treasury_checks")
    .select("wallet, bucket_ts, lamports, consensus_ok")
    .eq("project_key", projectKey)
    .order("bucket_ts", { ascending: false })
    .limit(50);
  if (error || !data || !data.length) return null;
  const rows = data as { wallet: string; bucket_ts: string; lamports: number; consensus_ok: boolean | null }[];
  const latestBucket = rows[0].bucket_ts;
  const inBucket = rows.filter((r) => r.bucket_ts === latestBucket);
  const agreed = inBucket.filter((r) => r.consensus_ok !== false);
  return {
    projectKey,
    wallet: rows[0].wallet,
    latestBucket,
    reporters: inBucket.length,
    agreedLamports: agreed[0]?.lamports ?? inBucket[0]?.lamports ?? null,
    dissenters: inBucket.filter((r) => r.consensus_ok === false).length,
  };
}
