import { Landing } from "@/components/landing/Landing";
import { getProjects } from "@/lib/queries";
import { getSolUsd } from "@/lib/price";
import { isAgentActive, getAgentState } from "@/lib/agent-data";
import { getRecentCommits } from "@/lib/commits";
import { getPublicPrelaunches } from "@/lib/prelaunch-public";

// Always fetch fresh so newly launched projects appear without a redeploy.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [projects, solUsd, prelaunches] = await Promise.all([
    getProjects(),
    getSolUsd(),
    getPublicPrelaunches(),
  ]);
  const loop = projects.find((p) => p.key === "loop");
  // Real "agent ticked recently" per LAUNCHED project — the honest per-card
  // status (was a hardcoded "Active" for anything with a mint). Plus a wide
  // commit window so the LIVE LOG can link shipped rows to their commit, and the
  // agent's real tasks for the loop-engine terminal (same source as the token
  // page, so the home terminal never drifts). All fall back to empty on failure.
  const launched = projects.filter((p) => p.mint);
  const [activeEntries, commitsAll, agentState] = await Promise.all([
    Promise.all(
      launched.map(async (p) => [p.key, await isAgentActive(p.key)] as const)
    ),
    loop
      ? getRecentCommits(loop.repo, 30)
      : Promise.resolve([] as { hash: string; msg: string }[]),
    loop ? getAgentState(loop) : Promise.resolve(null),
  ]);
  const activeByKey = Object.fromEntries(activeEntries);
  return (
    <Landing
      projects={projects}
      solUsd={solUsd}
      prelaunches={prelaunches}
      agentActive={!!activeByKey["loop"]}
      activeByKey={activeByKey}
      commits={commitsAll.slice(0, 6)}
      matchCommits={commitsAll}
      agentTasks={agentState?.tasks ?? []}
      agentLive={agentState?.live ?? false}
    />
  );
}
