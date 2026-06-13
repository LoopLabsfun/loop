import { Landing } from "@/components/landing/Landing";
import { getProjects } from "@/lib/queries";
import { getSolUsd } from "@/lib/price";

// Always fetch fresh so newly launched projects appear without a redeploy.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [projects, solUsd] = await Promise.all([getProjects(), getSolUsd()]);
  return <Landing projects={projects} solUsd={solUsd} />;
}
