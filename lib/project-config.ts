import "server-only";
import { supabaseAdmin } from "./supabase";

// LOT 5 — per-project OPERATOR knobs with env fallback. The founder overrides a
// small whitelist of runtime knobs per project; the runtime reads them as
// `{...process.env, ...overrides}` (effectiveEnv) and passes that to the existing
// PURE knob functions (tickCooldownMs / cadenceBounds), which already accept an
// injectable env — so no knob function changes, just a richer env at the call
// site. An unset override falls back to the platform env default.
//
// Only whitelisted keys are storable (CONFIGURABLE_KNOBS) — the editor and the
// route validate against it, so a config write can never inject an arbitrary env
// var. Stored as text (env shape); the pure functions parse/clamp as before.

export interface KnobSpec {
  /** The env var name the runtime reads (also the stored config key). */
  key: string;
  label: string;
  /** Short help shown in the cockpit editor. */
  hint: string;
}

// Per-project runtime knobs the founder may override. Kept tight: each is read
// by a pure, env-injectable function, so an override threads through with zero
// extra wiring beyond effectiveEnv().
export const CONFIGURABLE_KNOBS: KnobSpec[] = [
  {
    key: "AGENT_TICK_COOLDOWN_MIN",
    label: "Tick cooldown (min)",
    hint: "Base minutes between expensive ticks. '0' disables the cooldown. Default 60.",
  },
  {
    key: "AGENT_TICK_MIN_MIN",
    label: "Min cadence (min)",
    hint: "Fastest the project may tick when work is hot. Default 15.",
  },
  {
    key: "AGENT_TICK_MAX_MIN",
    label: "Max cadence (min)",
    hint: "Slowest the project stretches to when idle. Default 720.",
  },
];

const KNOB_KEYS = new Set(CONFIGURABLE_KNOBS.map((k) => k.key));

/** Whitelist guard — only known knobs are storable. */
export function isConfigurableKnob(key: string): boolean {
  return KNOB_KEYS.has(key);
}

/** All stored overrides for a project (key → value). Empty on unconfigured/error. */
export async function getProjectOverrides(projectKey: string): Promise<Record<string, string>> {
  const sb = supabaseAdmin;
  if (!sb) return {};
  const { data, error } = await sb
    .from("project_config")
    .select("key,value")
    .eq("project_key", projectKey);
  if (error || !data) return {};
  const out: Record<string, string> = {};
  for (const row of data as { key: string; value: string }[]) {
    // Defense-in-depth: ignore any stored key no longer whitelisted.
    if (KNOB_KEYS.has(row.key)) out[row.key] = row.value;
  }
  return out;
}

/**
 * The project's effective env: the platform env with its stored overrides laid
 * on top. Pass this to the pure knob functions (tickCooldownMs, cadenceBounds)
 * instead of process.env to honour per-project config.
 */
export async function effectiveEnv(
  projectKey: string,
  base: Record<string, string | undefined> = process.env
): Promise<Record<string, string | undefined>> {
  return { ...base, ...(await getProjectOverrides(projectKey)) };
}

export interface KnobView extends KnobSpec {
  /** The stored per-project override, or null when none (uses the env default). */
  override: string | null;
  /** The value the runtime actually uses: override ?? platform env ?? "" (default). */
  effective: string;
}

/** The cockpit view: every knob with its override + effective value. Read-only. */
export async function getConfigView(
  projectKey: string,
  base: Record<string, string | undefined> = process.env
): Promise<KnobView[]> {
  const overrides = await getProjectOverrides(projectKey);
  return CONFIGURABLE_KNOBS.map((spec) => {
    const override = overrides[spec.key] ?? null;
    return { ...spec, override, effective: override ?? base[spec.key] ?? "" };
  });
}

/** Set (upsert) a whitelisted knob override for a project. */
export async function setProjectConfig(
  projectKey: string,
  key: string,
  value: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isConfigurableKnob(key)) return { ok: false, error: `unknown knob ${key}` };
  const sb = supabaseAdmin;
  if (!sb) return { ok: false, error: "supabase not configured" };
  const { error } = await sb
    .from("project_config")
    .upsert(
      { project_key: projectKey, key, value: value.slice(0, 200), updated_at: new Date().toISOString() },
      { onConflict: "project_key,key" }
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Clear a knob override (revert to the platform env default). */
export async function clearProjectConfig(
  projectKey: string,
  key: string
): Promise<{ ok: boolean; error?: string }> {
  const sb = supabaseAdmin;
  if (!sb) return { ok: false, error: "supabase not configured" };
  const { error } = await sb
    .from("project_config")
    .delete()
    .eq("project_key", projectKey)
    .eq("key", key);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
