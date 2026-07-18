import "server-only";

import { supabase, supabaseAdmin } from "./supabase";

/**
 * Device-pool assists (Loop Compute): prep briefs produced by consumer devices
 * for agent_tasks. Prefer dedicated `device_assists` table; fall back to
 * `agent_actions` rows tagged [DEVICE_ASSIST] when the table is not migrated yet.
 */

export interface DeviceAssist {
  id: string;
  projectKey: string;
  taskId: number | null;
  jobId: string;
  title: string;
  deviceId: string;
  deviceName: string | null;
  complexity: string | null;
  keywords: string[];
  prepBrief: string;
  resultHash: string;
  createdAt: string;
  source: "device_assists" | "agent_actions";
}

const ACTION_PREFIX = "[DEVICE_ASSIST]";

export function formatDeviceAssistsForPrompt(assists: DeviceAssist[]): string {
  if (!assists.length) {
    return "(no device assists yet — consumer devices have not prepped backlog items)";
  }
  return assists
    .slice(0, 8)
    .map((a) => {
      const head = [
        `### Device assist · task #${a.taskId ?? "?"} · ${a.complexity ?? "?"}`,
        `**${a.title}**`,
        a.keywords.length ? `Keywords: ${a.keywords.slice(0, 8).join(", ")}` : null,
        `Device: ${a.deviceName || a.deviceId || "unknown"} · ${a.createdAt}`,
        "",
        a.prepBrief.slice(0, 1800),
      ]
        .filter(Boolean)
        .join("\n");
      return head;
    })
    .join("\n\n---\n\n");
}

/** Latest unconsumed (or recent) assists for a project. */
export async function getDeviceAssists(
  projectKey: string,
  limit = 8
): Promise<DeviceAssist[]> {
  // Prefer first-class table
  if (supabase) {
    const { data, error } = await supabase
      .from("device_assists")
      .select(
        "id, project_key, task_id, job_id, title, device_id, device_name, complexity, keywords, prep_brief, result_hash, created_at"
      )
      .eq("project_key", projectKey)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!error && data && data.length) {
      return (data as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        projectKey: String(r.project_key),
        taskId: r.task_id != null ? Number(r.task_id) : null,
        jobId: String(r.job_id ?? ""),
        title: String(r.title ?? ""),
        deviceId: String(r.device_id ?? ""),
        deviceName: (r.device_name as string) ?? null,
        complexity: (r.complexity as string) ?? null,
        keywords: Array.isArray(r.keywords) ? (r.keywords as string[]) : [],
        prepBrief: String(r.prep_brief ?? ""),
        resultHash: String(r.result_hash ?? ""),
        createdAt: String(r.created_at ?? ""),
        source: "device_assists" as const,
      }));
    }
  }

  // Fallback: agent_actions stream
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("agent_actions")
    .select("id, project_key, body, created_at")
    .eq("project_key", projectKey)
    .like("body", `${ACTION_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as { id: number; project_key: string; body: string; created_at: string }[]).map(
    (r) => parseActionBody(r)
  );
}

function parseActionBody(r: {
  id: number;
  project_key: string;
  body: string;
  created_at: string;
}): DeviceAssist {
  const body = r.body.startsWith(ACTION_PREFIX)
    ? r.body.slice(ACTION_PREFIX.length).trim()
    : r.body;
  // Header line: task=<id> job=<jobId> complexity=<c> | title
  const firstNl = body.indexOf("\n");
  const header = firstNl >= 0 ? body.slice(0, firstNl) : body;
  const rest = firstNl >= 0 ? body.slice(firstNl + 1).trim() : "";
  const taskM = header.match(/task=(\d+)/);
  const jobM = header.match(/job=([^\s|]+)/);
  const cxM = header.match(/complexity=([^\s|]+)/);
  const titleM = header.split("|").slice(1).join("|").trim();
  return {
    id: String(r.id),
    projectKey: r.project_key,
    taskId: taskM ? Number(taskM[1]) : null,
    jobId: jobM?.[1] ?? "",
    title: titleM || "device assist",
    deviceId: "",
    deviceName: null,
    complexity: cxM?.[1] ?? null,
    keywords: [],
    prepBrief: rest.slice(0, 4000),
    resultHash: "",
    createdAt: r.created_at,
    source: "agent_actions",
  };
}

export interface PublishDeviceAssistInput {
  projectKey: string;
  taskId: number;
  jobId: string;
  title: string;
  deviceId: string;
  deviceName?: string;
  complexity?: string;
  keywords?: string[];
  prepBrief: string;
  resultHash?: string;
  /** Contributor wallet that earns the reward for this assist. */
  payoutAddress?: string;
}

/**
 * Persist a device assist for the agent (service role).
 * Returns which backends accepted the write.
 */
export async function publishDeviceAssist(
  input: PublishDeviceAssistInput
): Promise<{ table: boolean; action: boolean; taskTouch: boolean; error?: string }> {
  if (!supabaseAdmin) {
    return { table: false, action: false, taskTouch: false, error: "no service role" };
  }

  let table = false;
  let action = false;
  let taskTouch = false;
  let error: string | undefined;

  // 1) First-class table (if migration applied)
  const { error: tErr } = await supabaseAdmin.from("device_assists").upsert(
    {
      project_key: input.projectKey,
      task_id: input.taskId || null,
      job_id: input.jobId,
      title: input.title.slice(0, 500),
      device_id: input.deviceId.slice(0, 128),
      device_name: input.deviceName?.slice(0, 128) ?? null,
      complexity: input.complexity?.slice(0, 16) ?? null,
      keywords: (input.keywords ?? []).slice(0, 20),
      prep_brief: input.prepBrief.slice(0, 12000),
      result_hash: (input.resultHash ?? "").slice(0, 128),
      source: "loop-compute",
      payout_address: input.payoutAddress?.slice(0, 64) ?? null,
    },
    { onConflict: "project_key,job_id" }
  );
  if (!tErr) table = true;
  else if (!/relation .* does not exist|Could not find the table/i.test(tErr.message)) {
    error = tErr.message;
  }

  // 2) Always mirror to agent_actions (public feed, agent-readable via fallback)
  const header = `${ACTION_PREFIX} task=${input.taskId} job=${input.jobId} complexity=${input.complexity ?? "?"} | ${input.title.slice(0, 120)}`;
  const body = `${header}\n\n${input.prepBrief.slice(0, 3500)}\n\n_device=${input.deviceName || input.deviceId}_`;
  const { error: aErr } = await supabaseAdmin.from("agent_actions").insert({
    project_key: input.projectKey,
    body: body.slice(0, 8000),
  });
  if (!aErr) action = true;
  else error = error ? `${error}; ${aErr.message}` : aErr.message;

  // 3) Touch the backlog task so the agent sees episodic memory on that item
  if (input.taskId > 0) {
    const note = `device assist ready (${input.complexity ?? "?"}): ${(input.keywords ?? []).slice(0, 5).join(", ") || "prep brief available"}`;
    const { error: uErr } = await supabaseAdmin
      .from("agent_tasks")
      .update({
        last_outcome: note.slice(0, 400),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.taskId)
      .eq("project_key", input.projectKey);
    if (!uErr) taskTouch = true;
  }

  // 4) Close the pool claim for this task (best-effort; table may not exist —
  // supabase-js reports that via `error`, it never throws here)
  if (input.taskId > 0) {
    await supabaseAdmin
      .from("device_job_claims")
      .update({ completed_at: new Date().toISOString(), assist_job_id: input.jobId })
      .eq("project_key", input.projectKey)
      .eq("task_id", input.taskId)
      .eq("device_id", input.deviceId);
  }

  return { table, action, taskTouch, error };
}

export interface ComputePoolStats {
  source: "device_assists" | "agent_actions" | "none";
  totalAssists: number;
  contributors: number;
  contributorsWithPayout: number;
  byProject: { projectKey: string; assists: number; devices: number }[];
  topContributors: { device: string; assists: number; hasPayout: boolean; trust: number | null }[];
  /** Devices consensus has flagged (trust < 1) — cheat suspects. */
  flaggedDevices: number;
  lastAssistAt: string | null;
}

/**
 * Public pool stats — makes the device network visible (recruiting surface).
 * Prefers the first-class table (has device + payout), falls back to the
 * agent_actions stream (counts only). Read-only, no secrets.
 */
export async function getComputePoolStats(limit = 500): Promise<ComputePoolStats> {
  const empty: ComputePoolStats = {
    source: "none",
    totalAssists: 0,
    contributors: 0,
    contributorsWithPayout: 0,
    byProject: [],
    topContributors: [],
    flaggedDevices: 0,
    lastAssistAt: null,
  };
  if (!supabase) return empty;

  const { data, error } = await supabase
    .from("device_assists")
    .select("project_key, device_id, device_name, payout_address, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  // Per-device consensus trust (best-effort; table may not exist yet).
  const trustByLabel = new Map<string, number>();
  const { data: trustRows } = await supabase
    .from("device_trust")
    .select("device_id, device_name, trust");
  for (const t of (trustRows ?? []) as { device_id: string; device_name: string | null; trust: number }[]) {
    trustByLabel.set(t.device_name || t.device_id, t.trust);
  }

  if (!error && data && data.length) {
    const rows = data as {
      project_key: string; device_id: string; device_name: string | null;
      payout_address: string | null; created_at: string;
    }[];
    const proj = new Map<string, Set<string>>();
    const projCount = new Map<string, number>();
    const dev = new Map<string, { assists: number; payout: boolean }>();
    const payoutSet = new Set<string>();
    for (const r of rows) {
      const label = r.device_name || r.device_id || "unknown";
      projCount.set(r.project_key, (projCount.get(r.project_key) ?? 0) + 1);
      (proj.get(r.project_key) ?? proj.set(r.project_key, new Set()).get(r.project_key)!).add(label);
      const d = dev.get(label) ?? { assists: 0, payout: false };
      d.assists++;
      if (r.payout_address) { d.payout = true; payoutSet.add(label); }
      dev.set(label, d);
    }
    return {
      source: "device_assists",
      totalAssists: rows.length,
      contributors: dev.size,
      contributorsWithPayout: payoutSet.size,
      byProject: Array.from(projCount.entries())
        .map(([projectKey, assists]) => ({ projectKey, assists, devices: proj.get(projectKey)?.size ?? 0 }))
        .sort((a, b) => b.assists - a.assists),
      topContributors: Array.from(dev.entries())
        .map(([device, v]) => ({ device, assists: v.assists, hasPayout: v.payout, trust: trustByLabel.get(device) ?? null }))
        .sort((a, b) => b.assists - a.assists)
        .slice(0, 10),
      flaggedDevices: Array.from(trustByLabel.values()).filter((t) => t < 1).length,
      lastAssistAt: rows[0]?.created_at ?? null,
    };
  }

  // Fallback: agent_actions counts only (no device/payout dimension there).
  const { data: acts } = await supabase
    .from("agent_actions")
    .select("project_key, created_at")
    .like("body", `${ACTION_PREFIX}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!acts || !acts.length) return empty;
  const rows = acts as { project_key: string; created_at: string }[];
  const projCount = new Map<string, number>();
  for (const r of rows) projCount.set(r.project_key, (projCount.get(r.project_key) ?? 0) + 1);
  return {
    ...empty,
    source: "agent_actions",
    totalAssists: rows.length,
    byProject: Array.from(projCount.entries())
      .map(([projectKey, assists]) => ({ projectKey, assists, devices: 0 }))
      .sort((a, b) => b.assists - a.assists),
    lastAssistAt: rows[0]?.created_at ?? null,
  };
}

/** Mark assists consumed after a tick that used them (best-effort). */
export async function markDeviceAssistsConsumed(
  projectKey: string,
  ids: string[]
): Promise<void> {
  if (!supabaseAdmin || !ids.length) return;
  const numeric = ids.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0);
  if (!numeric.length) return;
  await supabaseAdmin
    .from("device_assists")
    .update({ consumed_at: new Date().toISOString() })
    .eq("project_key", projectKey)
    .in("id", numeric);
}
