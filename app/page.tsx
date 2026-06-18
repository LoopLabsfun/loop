import { Landing } from "@/components/landing/Landing";
import { getProjects } from "@/lib/queries";
import { getSolUsd } from "@/lib/price";
import { isAgentActive } from "@/lib/agent-data";

// Always fetch fresh so newly launched projects appear without a redeploy.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [projects, solUsd, agentActive] = await Promise.all([
    getProjects(),
    getSolUsd(),
    isAgentActive("loop"),
  ]);
  return <Landing projects={projects} solUsd={solUsd} agentActive={agentActive} />;
}
