import "server-only";
import { supabaseAdmin } from "./supabase";

// Cross-project push serialization. Two independent project rows (e.g. a
// future LOOP-Solana + LOOP-Hood pair) can point at the SAME GitHub repo, each
// ticking on its own cadence — without this, their agent sessions could push
// to `main` around the same time. Git itself won't corrupt (repo-hands.ts
// rebases before pushing and just skips the push on conflict), but it means
// silently dropped/delayed commits on every collision. This makes that
// impossible: acquire the repo before starting a session that will push,
// release when it finishes. TTL-expiring (see acquire_repo_lock in
// supabase/schema.sql) so a crashed/never-finished session can't deadlock the
// repo forever — the next tick just reclaims it once the TTL passes.

const DEFAULT_TTL_MINUTES = 10;

/** Normalize a project's `repo` field (URL or bare slug) to "owner/name",
 *  the lock key — same normalization agent-session-enqueue.ts already did
 *  inline before this module existed. */
export function repoSlugOf(repo: string): string {
  return repo
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

/** Try to acquire the push lock for `repoSlug` on behalf of `projectKey`.
 *  Returns true if acquired (fresh or already held by this same project —
 *  re-acquiring is a no-op refresh), false if another project holds it and
 *  its TTL hasn't expired. Fails OPEN (returns true) when Supabase isn't
 *  configured, matching this codebase's fallback posture elsewhere. */
export async function acquireRepoLock(
  repoSlug: string,
  projectKey: string,
  ttlMinutes: number = DEFAULT_TTL_MINUTES
): Promise<boolean> {
  const sb = supabaseAdmin;
  if (!sb) return true;
  try {
    const { data, error } = await sb.rpc("acquire_repo_lock", {
      p_repo_slug: repoSlug,
      p_project_key: projectKey,
      p_ttl_minutes: ttlMinutes,
    });
    if (error) return true; // fail open — never let a lock outage stall the agent
    return Boolean(data);
  } catch {
    return true;
  }
}

/** Release the lock, only if still held by `projectKey` (a no-op otherwise —
 *  e.g. it already expired and was reclaimed by another project). */
export async function releaseRepoLock(repoSlug: string, projectKey: string): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) return;
  try {
    await sb.rpc("release_repo_lock", { p_repo_slug: repoSlug, p_project_key: projectKey });
  } catch {
    /* best-effort — worst case the TTL clears it */
  }
}
