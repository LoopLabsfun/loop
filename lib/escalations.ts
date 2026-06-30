import "server-only";
import { supabaseAdmin } from "./supabase";

// TYPED agent→founder request queue (docs/admin-cockpit.md §A). Backed by
// public.agent_escalations (kind/response/status). The agent RAISES a typed
// request when it needs the founder; the founder triages it in the cockpit.
//
// SECURITY: agent_escalations is PUBLICLY READABLE (RLS public-read). A
// `credential` request must NEVER carry the secret in `response` — the founder
// supplies it through the encrypted project_secrets path, and we only mark the
// request done. Only non-secret `info`/`action` notes are stored in `response`.

export type EscalationKind = "credential" | "action" | "decision" | "info";
export const ESCALATION_KINDS: EscalationKind[] = ["credential", "action", "decision", "info"];

export function isEscalationKind(x: unknown): x is EscalationKind {
  return typeof x === "string" && (ESCALATION_KINDS as string[]).includes(x);
}

/**
 * Count the run of consecutive failures at the head of a newest-first list of
 * dispositions (e.g. recent fee-claim attempts). Stops at the first non-"failed"
 * row. Pure — the caller fetches the rows and decides whether to escalate (see
 * shouldEscalateClaim in lib/creator-fees.ts). 'skipped' is not a failure.
 */
export function countLeadingFailures(dispositions: string[]): number {
  let n = 0;
  for (const d of dispositions) {
    if (d === "failed") n++;
    else break;
  }
  return n;
}

export interface EscalationRow {
  id: number;
  project_key: string;
  kind: EscalationKind;
  body: string;
  status: string;
  response: string | null;
  created_at: string;
  resolved_at: string | null;
}

/**
 * Raise a typed request to the founder, de-duped: if an OPEN request of the same
 * kind + body already exists for the project, it's a no-op (so a recurring signal
 * — e.g. repeated fee-claim failure — doesn't pile up duplicates). Returns the
 * row id (existing or new), or null when the DB is unconfigured / on error.
 */
export async function raiseEscalation(
  projectKey: string,
  kind: EscalationKind,
  body: string
): Promise<number | null> {
  const sb = supabaseAdmin;
  if (!sb) return null;
  const text = body.trim();
  if (!text) return null;

  const { data: dup } = await sb
    .from("agent_escalations")
    .select("id")
    .eq("project_key", projectKey)
    .eq("kind", kind)
    .eq("body", text)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (dup?.id) return dup.id as number;

  const { data, error } = await sb
    .from("agent_escalations")
    .insert({ project_key: projectKey, kind, body: text, status: "open" })
    .select("id")
    .single();
  if (error) return null;
  return (data?.id as number) ?? null;
}

export interface ResolveResult {
  ok: boolean;
  error?: string;
  status?: string;
}

export type ResolvePlan =
  | { ok: true; status: string; note: string | null }
  | { ok: false; error: string };

/**
 * Pure resolution policy (no I/O): map a (kind, decision, response) to the row
 * patch. Decisions adopt/decline; everything else resolves "done". The founder's
 * note is kept ONLY for info/action — never for credential (it would leak a
 * secret into the public table) or decision (no free-text channel). Capped 2000.
 */
export function planResolution(
  kind: EscalationKind,
  decision: "adopted" | "declined" | "done",
  response?: string
): ResolvePlan {
  if (kind === "decision") {
    if (decision !== "adopted" && decision !== "declined") {
      return { ok: false, error: "bad decision for a decision request" };
    }
    return { ok: true, status: decision, note: null };
  }
  const note =
    (kind === "info" || kind === "action") && response?.trim()
      ? response.trim().slice(0, 2000)
      : null;
  return { ok: true, status: "done", note };
}

/**
 * Resolve one open request. Decisions take adopt/decline (legacy semantics);
 * action/info/credential take "done", optionally with a non-secret response note
 * the agent reads next tick. Credential responses are dropped (never stored —
 * the secret goes through project_secrets, not this public table).
 */
export async function resolveEscalation(
  projectKey: string,
  id: number,
  decision: "adopted" | "declined" | "done",
  kind: EscalationKind,
  response?: string
): Promise<ResolveResult> {
  const sb = supabaseAdmin;
  if (!sb) return { ok: false, error: "supabase not configured" };

  const plan = planResolution(kind, decision, response);
  if (!plan.ok) return { ok: false, error: plan.error };

  const patch: Record<string, unknown> = {
    status: plan.status,
    resolved_at: new Date().toISOString(),
  };
  if (plan.note !== null) patch.response = plan.note;

  const { error } = await sb
    .from("agent_escalations")
    .update(patch)
    .eq("id", id)
    .eq("project_key", projectKey)
    .eq("status", "open");
  if (error) return { ok: false, error: error.message };
  return { ok: true, status: plan.status };
}
