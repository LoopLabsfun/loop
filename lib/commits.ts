import "server-only";

// Live recent-commits feed for a project's repo. Server-only so the GitHub
// call (and its rate limit) stays off the client, and so the result can be
// threaded into the Client token page as a prop — the same data-seam pattern
// as live treasury balances (solana.ts) and the live SOL price (price.ts).
//
// Returns [] on any failure or for repos that don't resolve; the UI falls
// back to its static commit list in that case. Set GITHUB_TOKEN (server-only)
// to read private repos and lift the unauthenticated 60 req/hr rate limit.

export interface RepoCommit {
  hash: string; // short sha
  msg: string; // first line of the commit message
}

// Accepts "github.com/owner/name", "https://github.com/owner/name(.git)",
// or "owner/name". Returns null when it isn't a GitHub owner/name pair.
function parseGitHubRepo(repo: string): { owner: string; name: string } | null {
  if (!repo) return null; // pre-launch projects have no repo yet
  const cleaned = repo
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  const parts = cleaned.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], name: parts[1] };
}

// Noise the agent never needs to see (and shouldn't edit): deps, build output,
// lockfiles, binaries/assets. Keeping the tree to real source keeps the prompt
// small and steers edits toward files that matter.
const TREE_IGNORE =
  /(^|\/)(node_modules|\.next|\.git|dist|build|coverage|out)\//i;
const TREE_IGNORE_EXT =
  /\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|eot|map|lock)$/i;
const TREE_IGNORE_FILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i;

/**
 * Pure: prune a raw repo path list to the source files worth showing the agent,
 * sorted, and hard-capped so the prompt stays bounded. Exported for testing.
 */
export function pruneRepoTree(paths: string[], max = 240): string[] {
  return paths
    .filter(
      (p) =>
        p &&
        !TREE_IGNORE.test(p) &&
        !TREE_IGNORE_EXT.test(p) &&
        !TREE_IGNORE_FILE.test(p)
    )
    .sort()
    .slice(0, max);
}

/**
 * The repo's real file tree (source paths only) so the agent plans + edits
 * against files that actually exist instead of inventing paths or "initializing"
 * a repo that's already there. Server-only; returns [] on any failure (the
 * decision still runs, just without the tree). Mirrors getRecentCommits.
 */
export async function getRepoTree(
  repo: string,
  branch = "main",
  max = 240
): Promise<string[]> {
  const parsed = parseGitHubRepo(repo);
  if (!parsed) return [];
  const { owner, name } = parsed;
  const token = process.env.GITHUB_TOKEN;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        next: { revalidate: 300 },
      }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      tree?: Array<{ path?: string; type?: string }>;
    };
    const paths = (json.tree ?? [])
      .filter((e) => e.type === "blob" && typeof e.path === "string")
      .map((e) => e.path as string);
    return pruneRepoTree(paths, max);
  } catch {
    return [];
  }
}

/**
 * Pure: clean + harden a list of requested read paths — strip leading "./",
 * reject absolute paths and "../" traversal, dedupe, cap. Exported for testing.
 */
export function sanitizeReadPaths(paths: string[], max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const p = (raw || "").trim().replace(/^\.\//, "");
    if (!p || p.startsWith("/") || p.split("/").includes("..") || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

export interface RepoFile {
  path: string;
  contents: string; // truncated; or a "(could not read …)" note on failure
}

/**
 * Fetch the real CONTENTS of specific repo files (A2 — code-aware context), so
 * the agent edits/plans against what's actually there instead of guessing. Each
 * file is hard-capped; a failed read becomes an honest note rather than throwing.
 * Server-only; mirrors getRecentCommits' auth + graceful-failure posture.
 */
export async function getRepoFiles(
  repo: string,
  paths: string[],
  branch = "main",
  maxBytesPerFile = 14000
): Promise<RepoFile[]> {
  const parsed = parseGitHubRepo(repo);
  if (!parsed) return [];
  const { owner, name } = parsed;
  const clean = sanitizeReadPaths(paths);
  if (!clean.length) return [];
  const token = process.env.GITHUB_TOKEN;
  return Promise.all(
    clean.map(async (path): Promise<RepoFile> => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${name}/contents/${path}?ref=${branch}`,
          {
            headers: {
              // raw media type returns the file body directly (no base64 decode)
              Accept: "application/vnd.github.raw+json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            next: { revalidate: 60 },
          }
        );
        if (!res.ok) return { path, contents: `(could not read — HTTP ${res.status})` };
        const body = await res.text();
        const contents =
          body.length > maxBytesPerFile
            ? body.slice(0, maxBytesPerFile) + "\n… (truncated)"
            : body;
        return { path, contents };
      } catch {
        return { path, contents: "(read failed)" };
      }
    })
  );
}

export interface DatedCommit {
  /** Full commit message (subject + body), so callers can scan for markers. */
  msg: string;
  /** Committer date in epoch ms. */
  date: number;
}

/**
 * Recent commits with their committer timestamps, newest-first. Used by the
 * deploy-throttle to find the most recent ACTUALLY-DEPLOYED commit (the newest
 * one without a `[no-deploy]` marker) and measure the gap since. Server-only;
 * returns [] on any failure (the throttle then errs toward deploying).
 */
export async function getRecentCommitsDated(
  repo: string,
  n = 30
): Promise<DatedCommit[]> {
  const parsed = parseGitHubRepo(repo);
  if (!parsed) return [];
  const { owner, name } = parsed;
  const token = process.env.GITHUB_TOKEN;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/commits?per_page=${n}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        // No cache: the throttle needs the live HEAD to decide build vs skip.
        cache: "no-store",
      }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as Array<{
      commit?: { message?: string; committer?: { date?: string } };
    }>;
    if (!Array.isArray(json)) return [];
    return json
      .filter((c) => c.commit?.message && c.commit.committer?.date)
      .map((c) => ({
        msg: c.commit!.message!,
        date: Date.parse(c.commit!.committer!.date!),
      }))
      .filter((c) => Number.isFinite(c.date));
  } catch {
    return [];
  }
}

export async function getRecentCommits(
  repo: string,
  n = 4
): Promise<RepoCommit[]> {
  const parsed = parseGitHubRepo(repo);
  if (!parsed) return [];
  const { owner, name } = parsed;
  const token = process.env.GITHUB_TOKEN;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/commits?per_page=${n}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        // Cache for 5 min across requests rather than hitting the GitHub API
        // (60 req/hr unauthenticated) on every render.
        next: { revalidate: 300 },
      }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as Array<{
      sha?: string;
      commit?: { message?: string };
    }>;
    if (!Array.isArray(json)) return [];
    return json
      .filter((c) => c.sha && c.commit?.message)
      .map((c) => ({
        hash: c.sha!.slice(0, 7),
        msg: c.commit!.message!.split("\n")[0],
      }));
  } catch {
    return [];
  }
}
