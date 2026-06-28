import type { Metadata } from "next";
import { TokenPageView } from "@/components/token/TokenPageView";
import { getProject } from "@/lib/queries";

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

// Public token page — now the v2 "merged" hero (identity + contract + price + Buy
// on the left, the live agent on the right): same data source, it surfaces what the
// project's agent is actually doing (building now, last ship, self-funding proof).
// Promoted from the founder-only /admin/v2 preview to prod.
export default async function TokenRoute({
  searchParams,
}: {
  searchParams: { p?: string };
}) {
  return <TokenPageView projectKey={searchParams.p ?? "loop"} hero="merged" />;
}
