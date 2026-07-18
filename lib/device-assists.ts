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

  return { table, action, taskTouch, error };
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
