// ─────────────────────────────────────────────────────────────────────────────
// WHITE-LABEL PROVISIONING — every project builds under Loop, never a personal
// account.
//
// A launched project needs a home for its code + deploys. To keep the platform
// white-label — the UI shows `LoopLabsfun/<slug>`, never the operator's personal
// GitHub/Vercel — each launch is auto-provisioned a GitHub repo under a Loop-
// owned org and a Vercel project under a Loop-owned team. The agent (with a
// scoped token) pushes and deploys there; the operator's account never appears.
//
// This is the pure planning seam: given a project key it derives collision-safe,
// valid repo + Vercel names/URLs and the org — deterministically, so the same
// project always maps to the same home. The repo string is the exact "owner/name"
// shape `Project.repo` + `lib/commits.ts` already parse, so it threads straight
// into the existing commit feed. The runtime's real GitHub/Vercel API calls
// *execute* the plan; this module decides *what* to create.
//
// Execution is env-gated, no-op safe (same pattern as compute-rail / email-send):
// `GITHUB_TOKEN` (repo create/push, scoped to the org) and `VERCEL_TOKEN` +
// `VERCEL_TEAM_ID` (project create/deploy). Unset = the plan still computes (for
// the UI / a dry run), but nothing is created.
// ─────────────────────────────────────────────────────────────────────────────

/** The Loop-owned GitHub org every project's repo lives under (override: GITHUB_ORG). */
export const DEFAULT_GITHUB_ORG = "LoopLabsfun";

/**
 * Sanitize a GitHub org login: alphanumerics + single hyphens, case preserved
 * (org logins are case-insensitive but should display as created). Falls back to
 * the default for empty/garbage. Distinct from `safeName`, which lowercases.
 */
export function safeOrg(org: string | undefined | null): string {
  const s = String(org ?? "")
    .trim()
    .replace(/[^A-Za-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || DEFAULT_GITHUB_ORG;
}

/**
 * Sanitize a project key into a valid GitHub repo / Vercel project name:
 * lowercase, `[a-z0-9-]` only, collapse repeated `-`, trim leading/trailing `-`,
 * and cap length (GitHub/Vercel allow 100; keep margin). Empty/garbage input
 * falls back to a stable default so a name is always produced.
 */
export function safeName(key: string): string {
  const s = String(key ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return s || "project";
}

export interface ProvisionPlan {
  /** The Loop-owned GitHub org. */
  org: string;
  /** "org/name" — the shape Project.repo + commits.ts expect. */
  repo: string;
  /** Canonical GitHub URL for the repo. */
  repoUrl: string;
  /** Vercel project name under the Loop team. */
  vercelProject: string;
  /** Intended production alias the runtime claims for the Vercel project. */
  vercelUrl: string;
}

/**
 * Pure: the deterministic provisioning plan for a project key. Same key → same
 * home, every time (so a re-run is idempotent, not a duplicate).
 */
export function provisionPlan(key: string, opts?: { org?: string }): ProvisionPlan {
  const org = safeOrg(opts?.org || process.env.GITHUB_ORG || DEFAULT_GITHUB_ORG);
  const name = safeName(key);
  return {
    org,
    repo: `${org}/${name}`,
    repoUrl: `https://github.com/${org}/${name}`,
    vercelProject: name,
    vercelUrl: `https://${name}.vercel.app`,
  };
}

/** Execution gate: can the runtime create/push a GitHub repo? */
export function githubConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

/** Execution gate: can the runtime create/deploy a Vercel project? */
export function vercelConfigured(): boolean {
  return !!(process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID);
}

/** True when both halves are wired, so a launch can be fully auto-provisioned. */
export function provisioningEnabled(): boolean {
  return githubConfigured() && vercelConfigured();
}
