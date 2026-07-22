import type { Metadata } from "next";
import { TokenPageView } from "@/components/token/TokenPageView";
import { getProject } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: { p?: string; chain?: string };
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

// Public token page — the hero (identity + contract + price + Buy on the left,
// the live agent on the right) surfaces what the project's agent is actually
// doing (building now, last ship, self-funding proof).
// `chain` selects which of a project's chain deployments to show the market
// side of — the SAME slug on every chain (one project, one agent, one backlog;
// each chain is just another way to fund it). The header's chain switch writes
// this param; an absent/unknown value falls back to the project's home chain.
export default async function TokenRoute({
  searchParams,
}: {
  searchParams: { p?: string; chain?: string };
}) {
  return (
    <TokenPageView projectKey={searchParams.p ?? "loop"} chain={searchParams.chain} />
  );
}
