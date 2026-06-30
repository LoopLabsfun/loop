import { safeName } from "./provisioning";

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT LIVE-SITE URL — where a project's real, agent-built website lives.
//
// Each non-official project deploys to its OWN per-project Vercel project (created
// at launch under the Loop team, slug = safeName(key)), so its public site is
// `<slug>-loop-labs-fun.vercel.app` until a creator points a custom domain at it.
// Pure + client-safe (no server-only / no env at import time) so the token page can
// link straight to the deployed site — that's where holders watch the agent work.
// ─────────────────────────────────────────────────────────────────────────────

/** Vercel team slug projects deploy under (override: NEXT_PUBLIC_VERCEL_TEAM_SLUG). */
const TEAM_SLUG =
  (process.env.NEXT_PUBLIC_VERCEL_TEAM_SLUG || "").trim() || "loop-labs-fun";

/** A project's default per-project Vercel deployment URL (its own deployed site). */
export function defaultVercelUrl(key: string): string {
  return `https://${safeName(key)}-${TEAM_SLUG}.vercel.app`;
}

/** True when the project has its own per-project Vercel deploy: a non-official
 *  project provisioned under the Loop org (repo "…LoopLabsfun/<slug>"). */
export function hasOwnDeploy(p: { official?: boolean | null; repo?: string | null }): boolean {
  return !p.official && !!p.repo && /(^|\/)LoopLabsfun\//i.test(p.repo);
}

/**
 * The best public "live site" URL for a project, in priority order:
 *   verified custom domain → creator-set website → its own Vercel deploy.
 * Official LOOP falls back to the platform site. Returns null only when none apply.
 */
export function projectSiteUrl(
  p: {
    key: string;
    domain?: string | null;
    website?: string | null;
    official?: boolean | null;
    repo?: string | null;
  },
  platformSite?: string | null,
): string | null {
  if (p.domain) return `https://${p.domain}`;
  if (p.website) return p.website;
  if (hasOwnDeploy(p)) return defaultVercelUrl(p.key);
  return platformSite ?? null;
}
