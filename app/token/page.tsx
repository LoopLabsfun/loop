import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TokenPage } from "@/components/token/TokenPage";
import { getProject } from "@/lib/queries";
import { getTokenView } from "@/lib/token-market";
import { getSolUsd } from "@/lib/price";
import { getRecentCommits } from "@/lib/commits";
import { getAgentState, getChat } from "@/lib/agent-data";
import { anthropicComputeSummary } from "@/lib/anthropic-cost";
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
  // Defining openGraph/twitter here replaces the root file-convention image,
  // so reference the site OG image explicitly to keep project links rich.
  const images = ["/opengraph-image"];
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
  const [view, solUsd, commitsAll, agentState, chat, compute, visitors] =
    await Promise.all([
      getTokenView(base),
      getSolUsd(),
      getRecentCommits(base.repo, 30),
      getAgentState(base),
      getChat(base.key),
      base.official ? anthropicComputeSummary() : Promise.resolve(null),
      base.official ? getVercelVisitorsTotal(SINCE_ISO) : Promise.resolve(null),
    ]);
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
      visitors={visitors}
    />
  );
}
