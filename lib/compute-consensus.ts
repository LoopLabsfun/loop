import "server-only";

import { supabase, supabaseAdmin } from "./supabase";

/**
 * Server-side k-redundancy consensus — the device pool checking itself.
 *
 * The device brief's deterministic core means honest devices produce the same
 * result_hash for the same task. When k>1 devices touch a task, the majority
 * hash is truth; a device that published a different hash lied (or ran modified
 * code). This module recomputes consensus over `device_assists`, records a
 * per-device trust score in `device_trust`, and flags dissenting rows — no
 * trusted oracle, no reference re-execution. Rewards read the trust so cheaters
 * earn less. Pure `computeConsensus` is unit-tested; `runConsensus` does I/O.
 */

export interface AssistRow {
  id: number;
  project_key: string;
  task_id: number | null;
  result_hash: string;
  device_id: string;
  device_name: string | null;
}

export interface DeviceTrust {
  deviceId: string;
  projectKey: string;
  deviceName: string | null;
  redundantAssists: number;
  agreed: number;
  dissented: number;
  trust: number;
}

export interface ConsensusResult {
  trust: DeviceTrust[];
  /** device_assists ids and whether they agree with their task's majority. */
  verdicts: { id: number; consensusOk: boolean }[];
  tasksVerified: number;
  dissentCount: number;
}

/** Most frequent value, deterministic lexicographic tiebreak. */
function majority(hashes: string[]): string | null {
  const counts = new Map<string, number>();
  for (const h of hashes) counts.set(h, (counts.get(h) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [h, n] of Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > bestN) {
      best = h;
      bestN = n;
    }
  }
  return best;
}

/** Pure consensus + trust over a set of assist rows. */
export function computeConsensus(rows: AssistRow[]): ConsensusResult {
  const byTask = new Map<string, AssistRow[]>();
  for (const r of rows) {
    if (!r.result_hash || r.task_id == null) continue;
    const key = `${r.project_key}:${r.task_id}`;
    (byTask.get(key) ?? byTask.set(key, []).get(key)!).push(r);
  }

  const verdicts: { id: number; consensusOk: boolean }[] = [];
  const trustAcc = new Map<string, DeviceTrust>();
  let tasksVerified = 0;
  let dissentCount = 0;

  for (const group of Array.from(byTask.values())) {
    if (group.length < 2) continue; // consensus needs redundancy
    tasksVerified++;
    const consensus = majority(group.map((g: AssistRow) => g.result_hash));
    for (const r of group) {
      const ok = r.result_hash === consensus;
      verdicts.push({ id: r.id, consensusOk: ok });
      if (!ok) dissentCount++;
      const tkey = `${r.device_id}:${r.project_key}`;
      const t =
        trustAcc.get(tkey) ??
        trustAcc
          .set(tkey, {
            deviceId: r.device_id,
            projectKey: r.project_key,
            deviceName: r.device_name,
            redundantAssists: 0,
            agreed: 0,
            dissented: 0,
            trust: 1,
          })
          .get(tkey)!;
      t.redundantAssists++;
      if (ok) t.agreed++;
      else t.dissented++;
    }
  }
  for (const t of Array.from(trustAcc.values())) {
    t.trust = t.redundantAssists ? t.agreed / t.redundantAssists : 1;
  }

  return {
    trust: Array.from(trustAcc.values()).sort((a, b) => a.trust - b.trust),
    verdicts,
    tasksVerified,
    dissentCount,
  };
}

/**
 * Run consensus over recent assists and persist the results (service role).
 * Best-effort; returns a summary. No-op when the tables aren't there.
 */
export async function runConsensus(limit = 2000): Promise<
  { ok: false; error: string } | ({ ok: true } & Omit<ConsensusResult, "verdicts"> & { devices: number })
> {
  if (!supabase || !supabaseAdmin) return { ok: false, error: "supabase not configured" };
  const { data, error } = await supabase
    .from("device_assists")
    .select("id, project_key, task_id, result_hash, device_id, device_name")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as AssistRow[];
  const result = computeConsensus(rows);

  // Persist per-device trust (upsert).
  if (result.trust.length) {
    await supabaseAdmin.from("device_trust").upsert(
      result.trust.map((t) => ({
        device_id: t.deviceId,
        project_key: t.projectKey,
        device_name: t.deviceName,
        redundant_assists: t.redundantAssists,
        agreed: t.agreed,
        dissented: t.dissented,
        trust: t.trust,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "device_id,project_key" }
    );
  }
  // Flag dissenting / confirm agreeing assists (only the verified ones).
  const dissenters = result.verdicts.filter((v) => !v.consensusOk).map((v) => v.id);
  const agreers = result.verdicts.filter((v) => v.consensusOk).map((v) => v.id);
  if (dissenters.length) {
    await supabaseAdmin.from("device_assists").update({ consensus_ok: false }).in("id", dissenters);
  }
  if (agreers.length) {
    await supabaseAdmin.from("device_assists").update({ consensus_ok: true }).in("id", agreers);
  }

  return {
    ok: true,
    trust: result.trust,
    tasksVerified: result.tasksVerified,
    dissentCount: result.dissentCount,
    devices: result.trust.length,
  };
}
