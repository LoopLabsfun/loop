import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TokenPage } from "@/components/token/TokenPage";
import { getProject } from "@/lib/queries";
import { getTokenView } from "@/lib/token-market";
import { getSolUsd } from "@/lib/price";
import { getRecentCommits } from "@/lib/commits";
import { getAgentState } from "@/lib/agent-data";

export const dynamic = "force-dynamic";

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
  const [view, solUsd, commits, agentState] = await Promise.all([
    getTokenView(base),
    getSolUsd(),
    getRecentCommits(base.repo),
    getAgentState(base),
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
      commits={commits}
      agentState={agentState}
    />
  );
}
