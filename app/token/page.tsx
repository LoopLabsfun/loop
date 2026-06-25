import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TokenPage } from "@/components/token/TokenPage";
import { getProject } from "@/lib/queries";
import { getTokenView } from "@/lib/token-market";
import { getSolUsd } from "@/lib/price";
import { getRecentCommits } from "@/lib/commits";
import { getAgentState, getChat } from "@/lib/agent-data";
import { anthropicComputeSummary } from "@/lib/anthropic-cost";
import { getComputeLedger } from "@/lib/compute-ledger-store";
import { getFeeLedger } from "@/lib/fee-ledger-store";
import { getVercelVisitorsTotal } from "@/lib/vercel-analytics";

export const dynamic = "force-dynamic";

// Window for "since launch" metrics (Claude spend + Vercel visitors). Snaps to
// the LOOP token's creation day; overridable so other deployments can retarget.
const SINCE_ISO = process.env.ANTHROPIC_COST_SINCE || "2026-06-16T00:00:00Z";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: { p?: string };
}): Promise<Metadata> {
  // Mirror the route's fallback so the tab title matches what renders.
  const project =
    (await getProject(searchParams.p ?? "loop")) ?? (await getProject("loop"));
  if (!project) return { title: "Loop" };

  const title = `${project.name} (${project.ticker}) — Loop`;
  const description =
    project.description ||
    `${project.name} — an autonomous project funded by its market on Loop.`;
  // Per-project share card with the token's LIVE price + market cap baked in
  // (app/token-og), so a shared /token link renders the real numbers instead of
  // the generic site card.
  const images = [`/token-og?p=${encodeURIComponent(project.key)}`];
  return {
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Loop", images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export default async function TokenRoute({
  searchParams,
}: {
  searchParams: { p?: string };
}) {
  const base =
    (await getProject(searchParams.p ?? "loop")) ?? (await getProject("loop"));
  if (!base) notFound();
  // Compute (Claude spend) is org-wide and visitors are site-wide, so both are
  // only meaningful on the official project; fetch them only there.
  const [view, solUsd, commitsAll, agentState, chat, computeApi, computeLedger, feeLedger, visitors] =
    await Promise.all([
      getTokenView(base),
      getSolUsd(),
      getRecentCommits(base.repo, 30),
      getAgentState(base),
      getChat(base.key),
      base.official ? anthropicComputeSummary() : Promise.resolve(null),
      base.official ? getComputeLedger(base.key) : Promise.resolve(null),
      getFeeLedger(base.key),
      base.official ? getVercelVisitorsTotal(SINCE_ISO) : Promise.resolve(null),
    ]);
  // Prefer the Admin Cost API; fall back to the metered compute_ledger row
  // (populated by the agent runtime after every tick).
  const compute =
    computeApi ??
    (computeLedger && computeLedger.consumedUsd > 0
      ? {
          spentUsd: computeLedger.consumedUsd,
          sinceISO: SINCE_ISO,
          // There is NO Anthropic balance API for an individual account, so the
          // manually-seeded compute_ledger can't track real "remaining credit":
          // credited_usd goes stale between top-ups and, once over-drawn, the
          // widget published a misleading "$0.00 left" that reads as a dead agent.
          // So we DON'T publish a "remaining" off the manual ledger — only the
          // best-effort cumulative spend (now that SDK-session cost is metered).
          // The founder watches the true balance in the Anthropic console. The
          // Admin Cost API path above keeps both, since it has a real source.
          startingCreditUsd: null,
          remainingUsd: null,
        }
      : null);
  return (
    <TokenPage
      project={view.project}
      market={{
        stats: view.stats,
        candles: view.candles,
        trades: view.trades,
        holders: view.holders,
      }}
      agentSol={view.agentSol}
      solUsd={solUsd}
      commits={commitsAll.slice(0, 6)}
      matchCommits={commitsAll}
      agentState={agentState}
      chat={chat}
      compute={compute}
      feeLedger={feeLedger}
      visitors={visitors}
    />
  );
}
