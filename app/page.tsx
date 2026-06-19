import { Landing } from "@/components/landing/Landing";
import { getProjects } from "@/lib/queries";
import { getSolUsd } from "@/lib/price";
import { isAgentActive } from "@/lib/agent-data";
import { getRecentCommits } from "@/lib/commits";

// Always fetch fresh so newly launched projects appear without a redeploy.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [projects, solUsd, agentActive] = await Promise.all([
    getProjects(),
    getSolUsd(),
    isAgentActive("loop"),
  ]);
  // Real recent commits for the landing treasury/terminal widget (honest build
  // stream, same source as the token page). Falls back to [] on any failure.
  const loop = projects.find((p) => p.key === "loop");
  const commits = loop ? await getRecentCommits(loop.repo) : [];
  return (
    <Landing
      projects={projects}
      solUsd={solUsd}
      agentActive={agentActive}
      commits={commits}
    />
  );
}
