import "server-only";
import { supabaseAdmin } from "./supabase";
import { makeSplit } from "./fees";
import {
  NAME_MAX,
  DESCRIPTION_MAX,
  PROMPT_MAX,
  REPO_MAX,
  GUARDRAILS_MAX,
  CONTENT_POLICY_MAX,
  GITHUB_RE,
} from "./launch";
import { setProjectAnthropicKey, secretsConfigured } from "./project-secrets";

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM-ADMIN PROJECT CONTROL — the founder's "hand" over EVERY project.
//
// The /admin console is gated on the LOOP creator_wallet (the platform super-admin):
// once signed in, the founder can edit any project's mutable fields, set its BYO
// agent API key, and pause/resume its agent — for third-party projects too, whose
// own creator_wallet differs. Pure-ish: validation is local, writes go through the
// service-role client. Immutable on-chain facts (mint, ticker symbol, wallets,
// network, creator_wallet, launch_payment_sig) are NOT editable here by design.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminProjectRow {
  key: string;
  name: string;
  ticker: string;
  description: string | null;
  prompt: string | null;
  repo: string | null;
  cover: string | null;
  guardrails: string | null;
  contentPolicy: string | null;
  feeFounderPct: number | null;
  /** founder/agent/platform label derived from the lever (platform fixed 5). */
  splitLabel: string;
  official: boolean;
  network: string | null;
  mint: string | null;
  creatorWallet: string | null;
  treasuryWallet: string | null;
  agentWallet: string | null;
  agentPaused: boolean;
  /** Whether a per-project BYO Anthropic key is stored (never the key itself). */
  hasAgentKey: boolean;
  treasurySol: number | null;
  earnedSol: number | null;
}

const COVER_MAX = 40;

/** Every launched project for the platform-admin panel (newest first). Best-effort:
 *  a cold backend returns []. Reports whether each has a stored agent key (not the key). */
export async function listAdminProjects(): Promise<AdminProjectRow[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const { data } = await sb
    .from("projects")
    .select(
      "key,name,ticker,description,prompt,repo,cover,guardrails,content_policy,fee_founder_pct,official,network,mint,creator_wallet,treasury_wallet,agent_wallet,agent_paused,treasury_sol,earned_sol,created_at",
    )
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Record<string, unknown>[];

  // Which keys have a stored secret (one query, not N) — only when the store is armed.
  let keysWithSecret = new Set<string>();
  if (secretsConfigured() && rows.length) {
    const { data: secs } = await sb
      .from("project_secrets")
      .select("project_key")
      .not("anthropic_key_enc", "is", null);
    keysWithSecret = new Set(((secs ?? []) as { project_key: string }[]).map((s) => s.project_key));
  }

  return rows.map((r) => {
    const fee = (r.fee_founder_pct as number) ?? null;
    const split = makeSplit(fee ?? 30);
    return {
      key: r.key as string,
      name: r.name as string,
      ticker: (r.ticker as string) ?? "",
      description: (r.description as string) ?? null,
      prompt: (r.prompt as string) ?? null,
      repo: (r.repo as string) ?? null,
      cover: (r.cover as string) ?? null,
      guardrails: (r.guardrails as string) ?? null,
      contentPolicy: (r.content_policy as string) ?? null,
      feeFounderPct: fee,
      splitLabel: `${split.founderPct}/${split.agentPct}/${split.platformPct}`,
      official: Boolean(r.official),
      network: (r.network as string) ?? null,
      mint: (r.mint as string) ?? null,
      creatorWallet: (r.creator_wallet as string) ?? null,
      treasuryWallet: (r.treasury_wallet as string) ?? null,
      agentWallet: (r.agent_wallet as string) ?? null,
      agentPaused: Boolean(r.agent_paused),
      hasAgentKey: keysWithSecret.has(r.key as string),
      treasurySol: typeof r.treasury_sol === "number" ? (r.treasury_sol as number) : null,
      earnedSol: typeof r.earned_sol === "number" ? (r.earned_sol as number) : null,
    };
  });
}

export interface ProjectFieldPatch {
  name?: string | null;
  description?: string | null;
  prompt?: string | null;
  repo?: string | null;
  cover?: string | null;
  guardrails?: string | null;
  contentPolicy?: string | null;
  feeFounderPct?: number | null;
}

function cap(s: unknown, n: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, n) : null;
}

/**
 * Sanitize a partial project edit into the snake_case row patch actually written.
 * Only keys PRESENT in the input are touched (so an edit of just the fee never
 * clears the description). The fee lever is clamped through makeSplit; repo keeps
 * only a plausible GitHub URL (else cleared); free-text is length-capped. Returns
 * `{}` when nothing valid was provided. Pure + unit-testable.
 */
export function sanitizeProjectPatch(input: ProjectFieldPatch): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if ("name" in input) {
    const v = cap(input.name, NAME_MAX);
    if (v) patch.name = v; // name is required on a row — never blank it
  }
  if ("description" in input) patch.description = cap(input.description, DESCRIPTION_MAX);
  if ("prompt" in input) patch.prompt = cap(input.prompt, PROMPT_MAX);
  if ("repo" in input) {
    const v = cap(input.repo, REPO_MAX);
    patch.repo = v && GITHUB_RE.test(v) ? v : null;
  }
  if ("cover" in input) patch.cover = cap(input.cover, COVER_MAX);
  if ("guardrails" in input) patch.guardrails = cap(input.guardrails, GUARDRAILS_MAX);
  if ("contentPolicy" in input) patch.content_policy = cap(input.contentPolicy, CONTENT_POLICY_MAX);
  if ("feeFounderPct" in input && input.feeFounderPct != null && Number.isFinite(Number(input.feeFounderPct))) {
    patch.fee_founder_pct = makeSplit(Number(input.feeFounderPct)).founderPct;
  }
  return patch;
}

/** Apply a field edit to a launched project. Throws on no project / nothing to change. */
export async function updateProjectFields(key: string, input: ProjectFieldPatch): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) throw new Error("Supabase service role not configured.");
  const patch = sanitizeProjectPatch(input);
  if (!Object.keys(patch).length) throw new Error("No editable fields provided.");
  const { data, error } = await sb.from("projects").update(patch).eq("key", key).select("key");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error(`Project ${key} not found.`);
}

/** Pause or resume a project's agent (multi-tenant — any project, by key). */
export async function setProjectPaused(key: string, paused: boolean): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) throw new Error("Supabase service role not configured.");
  const { data, error } = await sb
    .from("projects")
    .update({ agent_paused: paused })
    .eq("key", key)
    .select("key");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error(`Project ${key} not found.`);
}

/** Set a project's BYO Anthropic key (encrypted at rest). Requires the store armed. */
export async function setProjectAgentKey(key: string, plain: string): Promise<void> {
  if (!secretsConfigured()) {
    throw new Error("Per-project key store is off — set PROJECT_SECRETS_KEY first.");
  }
  const k = plain.trim();
  if (!k) throw new Error("Empty key.");
  if (!/^sk-ant-/.test(k)) throw new Error("That doesn't look like an Anthropic key (expected sk-ant-…).");
  await setProjectAnthropicKey(key, k);
}
