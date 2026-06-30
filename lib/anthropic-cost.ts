import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// ANTHROPIC COMPUTE — real Claude API spend + remaining credit.
//
// The agent's biggest infra cost is Claude itself, and Loop is "an autonomous
// software company funded by fees" — so the Compute line should show the REAL
// spend, not a modeled estimate. The Anthropic Admin **Cost API**
// (GET /v1/organizations/cost_report) returns historical USD cost per day; we
// sum every bucket since the project's genesis (token launch) to get the total
// Claude spend to date.
//
// IMPORTANT shape facts (from the Cost API reference):
//   • Auth: an **Admin** API key (sk-ant-admin01-…), header `x-api-key`, plus
//     `anthropic-version: 2023-06-01`. A normal key 401s — the Admin API needs
//     an org (unavailable for individual accounts).
//   • `amount` is a DECIMAL STRING in the LOWEST currency unit (cents): "123.45"
//     == $1.2345. So USD = sum(parseFloat(amount)) / 100.
//   • Daily granularity only (bucket_width=1d); paginate via has_more/next_page.
//
// Anthropic exposes spend but NOT a live credit balance, so "remaining" is
// modeled as a configured starting credit minus the measured spend. Both come
// from env so nothing is hardcoded:
//   ANTHROPIC_ADMIN_KEY          — the admin key (server-only secret)
//   ANTHROPIC_STARTING_CREDIT_USD — starting credit, USD (optional → no remaining)
//   ANTHROPIC_COST_SINCE          — RFC3339 genesis (default: LOOP launch day)
//
// Best-effort + memoized: unconfigured / failed reads return null so the UI
// shows an honest "—" (and the modeled estimate) instead of a fake number.
// ─────────────────────────────────────────────────────────────────────────────

const COST_URL = "https://api.anthropic.com/v1/organizations/cost_report";

// LOOP's token was created 2026-06-16 (the projects row's created_at). The Cost
// API snaps `starting_at` to the start of the UTC day, so a midnight stamp is
// exact. Overridable for other deployments / projects.
const DEFAULT_GENESIS = "2026-06-16T00:00:00Z";

export interface ComputeSummary {
  /** Total real Claude API spend (USD) since `sinceISO`. */
  spentUsd: number;
  /** RFC3339 start of the window the spend covers. */
  sinceISO: string;
  /** Configured starting credit (USD), or null when unset. */
  startingCreditUsd: number | null;
  /** startingCreditUsd − spentUsd, or null when no starting credit configured. */
  remainingUsd: number | null;
}

/** Shape of the `usage` block returned by every Messages API response. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

// Prices in USD per 1 M tokens (input / output / cacheWrite / cacheRead).
// cacheWrite = 1.25× input; cacheRead = 0.1× input.
const MODEL_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-4-8":           { input: 5.00, output: 25.00, cacheWrite: 6.25, cacheRead: 0.50 },
  "claude-opus-4-7":           { input: 5.00, output: 25.00, cacheWrite: 6.25, cacheRead: 0.50 },
  "claude-opus-4-6":           { input: 5.00, output: 25.00, cacheWrite: 6.25, cacheRead: 0.50 },
  "claude-sonnet-5":           { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-sonnet-4-6":         { input: 3.00, output: 15.00, cacheWrite: 3.75, cacheRead: 0.30 },
  "claude-haiku-4-5-20251001": { input: 1.00, output:  5.00, cacheWrite: 1.25, cacheRead: 0.10 },
  "claude-haiku-4-5":          { input: 1.00, output:  5.00, cacheWrite: 1.25, cacheRead: 0.10 },
};

/**
 * Convert a Messages API usage block to USD. Unknown CLAUDE models fall back to
 * Opus pricing (conservative); non-Claude models (e.g. a Groq open-weight routed
 * through lib/llm.ts) are not billed to the Anthropic credit, so they cost $0 here.
 */
export function tokensToUsd(usage: TokenUsage | null | undefined, model: string): number {
  if (!usage) return 0;
  const known = MODEL_PRICING[model];
  if (!known && !model.startsWith("claude")) return 0;
  const p = known ?? MODEL_PRICING["claude-opus-4-8"]!;
  return (
    (usage.input_tokens / 1_000_000) * p.input +
    (usage.output_tokens / 1_000_000) * p.output +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * p.cacheWrite +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * p.cacheRead
  );
}

interface CostResult {
  amount?: string;
  currency?: string;
}
interface CostBucket {
  results?: CostResult[];
}
interface CostReport {
  data?: CostBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

function costSince(): string {
  return process.env.ANTHROPIC_COST_SINCE?.trim() || DEFAULT_GENESIS;
}

function startingCreditUsd(): number | null {
  const raw = process.env.ANTHROPIC_STARTING_CREDIT_USD?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Sum every cost bucket's results into total USD. `amount` is a cents string, so
 * we accumulate cents and divide once at the end (avoids float drift). Pure +
 * exported for testing — give it the raw `data` array from one or more pages.
 */
export function sumCostUsd(buckets: CostBucket[]): number {
  let cents = 0;
  for (const b of buckets) {
    for (const r of b.results ?? []) {
      const v = parseFloat(r.amount ?? "");
      if (Number.isFinite(v)) cents += v;
    }
  }
  return Math.round(cents) / 100;
}

// Spend changes slowly and the Cost API asks callers to poll ≤ 1/min; memoize so
// every force-dynamic render doesn't hit the Admin API. 10-min TTL.
const TTL_MS = 10 * 60 * 1000;
let memo: { at: number; v: ComputeSummary | null } | null = null;

async function fetchCostUsd(sinceISO: string): Promise<number | null> {
  const key = process.env.ANTHROPIC_ADMIN_KEY?.trim();
  if (!key) return null;
  try {
    const buckets: CostBucket[] = [];
    let page: string | undefined;
    // Bounded loop: 31 daily buckets per page; cap pages so a runaway never hangs
    // the render (a year of data is ~12 pages).
    for (let i = 0; i < 24; i++) {
      const params = new URLSearchParams({
        starting_at: sinceISO,
        bucket_width: "1d",
        limit: "31",
      });
      if (page) params.set("page", page);
      const res = await fetch(`${COST_URL}?${params.toString()}`, {
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return buckets.length ? sumCostUsd(buckets) : null;
      const json = (await res.json()) as CostReport;
      if (Array.isArray(json.data)) buckets.push(...json.data);
      if (!json.has_more || !json.next_page) break;
      page = json.next_page;
    }
    return sumCostUsd(buckets);
  } catch {
    return null;
  }
}

/**
 * Real Claude API spend since genesis + modeled remaining credit, or null when
 * the Admin key is unset / the read fails (caller shows "—"). Memoized.
 */
export async function anthropicComputeSummary(): Promise<ComputeSummary | null> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.v;
  const sinceISO = costSince();
  const spent = await fetchCostUsd(sinceISO);
  let v: ComputeSummary | null = null;
  if (spent !== null) {
    const start = startingCreditUsd();
    v = {
      spentUsd: spent,
      sinceISO,
      startingCreditUsd: start,
      remainingUsd: start === null ? null : Math.max(0, Math.round((start - spent) * 100) / 100),
    };
  }
  // Cache successes; on failure cache the null briefly too so a down Admin API
  // doesn't get hammered every render.
  memo = { at: Date.now(), v };
  return v;
}
