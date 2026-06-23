import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// VERCEL ANALYTICS — real total visitors for the "Autonomous work" stats.
//
// Vercel Web Analytics has NO officially documented read API; the dashboard
// calls an internal endpoint. We read that endpoint with a Vercel token. Because
// it's undocumented and can change, EVERYTHING is configurable via env and the
// read is best-effort: any failure returns null and the UI shows an honest "—".
//
//   VERCEL_TOKEN              — a Vercel access token (server-only secret)
//   VERCEL_PROJECT_ID         — the project's id (prj_…) or its name
//   VERCEL_TEAM_ID            — team/owner id, if the project lives under a team
//   VERCEL_ANALYTICS_ENDPOINT — override the base path if Vercel moves it
//                               (default: the web-analytics overview endpoint)
//
// The shape of the JSON varies, so `extractVisitors` walks a few known shapes
// (and a generic deep search for a visitors total) rather than assuming one.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_ENDPOINT = "https://vercel.com/api/web-analytics/overview";

function cfg() {
  return {
    token: process.env.VERCEL_TOKEN?.trim() || "",
    projectId: process.env.VERCEL_PROJECT_ID?.trim() || "",
    teamId: process.env.VERCEL_TEAM_ID?.trim() || "",
    endpoint: process.env.VERCEL_ANALYTICS_ENDPOINT?.trim() || DEFAULT_ENDPOINT,
  };
}

/**
 * Pull a "total visitors" number out of an unknown Vercel analytics payload.
 * Tries the common overview shapes first, then a bounded deep search for a
 * `visitors`/`uniques`-keyed total. Returns null when nothing plausible is
 * found. Pure + exported for testing.
 */
export function extractVisitors(json: unknown): number | null {
  if (json == null || typeof json !== "object") return null;

  // Known overview shapes: { visitors: { total } } | { devices: { total } } |
  // { total: { visitors } } | { data: { visitors } }.
  const obj = json as Record<string, unknown>;
  const direct =
    pickNum((obj.visitors as Record<string, unknown>)?.total) ??
    pickNum((obj.devices as Record<string, unknown>)?.total) ??
    pickNum((obj.total as Record<string, unknown>)?.visitors) ??
    pickNum((obj.data as Record<string, unknown>)?.visitors) ??
    pickNum(obj.visitors) ??
    pickNum(obj.uniques);
  if (direct !== null) return direct;

  // Generic bounded deep search: the largest value under a visitors/uniques key.
  let best: number | null = null;
  const visit = (v: unknown, depth: number) => {
    if (depth > 5 || v == null) return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1);
      return;
    }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (/^(visitors|uniques|unique_visitors)$/i.test(k)) {
          const n = pickNum(val);
          if (n !== null && (best === null || n > best)) best = n;
        }
        visit(val, depth + 1);
      }
    }
  };
  visit(json, 0);
  return best;
}

function pickNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Visitor totals barely move between renders — memoize so force-dynamic pages
// don't hit Vercel on every request. 10-min TTL.
const TTL_MS = 10 * 60 * 1000;
let memo: { at: number; since: string; v: number | null } | null = null;

/**
 * Total Vercel Web Analytics visitors since `sinceISO` (to now), or null when
 * unconfigured / on any failure. Best-effort against an undocumented endpoint.
 */
export async function getVercelVisitorsTotal(sinceISO: string): Promise<number | null> {
  if (memo && memo.since === sinceISO && Date.now() - memo.at < TTL_MS) return memo.v;
  const { token, projectId, teamId, endpoint } = cfg();
  if (!token || !projectId) return null;
  try {
    const params = new URLSearchParams({
      projectId,
      environment: "production",
      from: sinceISO,
      to: new Date().toISOString(),
    });
    if (teamId) params.set("teamId", teamId);
    const res = await fetch(`${endpoint}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return cache(sinceISO, null);
    const json = await res.json();
    return cache(sinceISO, extractVisitors(json));
  } catch {
    return cache(sinceISO, null);
  }
}

function cache(since: string, v: number | null): number | null {
  memo = { at: Date.now(), since, v };
  return v;
}
