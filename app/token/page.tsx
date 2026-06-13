import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TokenPage } from "@/components/token/TokenPage";
import { getProject } from "@/lib/queries";
import { getSolUsd } from "@/lib/price";
import { getRecentCommits } from "@/lib/commits";

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
  const project =
    (await getProject(searchParams.p ?? "loop")) ?? (await getProject("loop"));
  if (!project) notFound();
  const [solUsd, commits] = await Promise.all([
    getSolUsd(),
    getRecentCommits(project.repo),
  ]);
  return <TokenPage project={project} solUsd={solUsd} commits={commits} />;
}
