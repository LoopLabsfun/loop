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
