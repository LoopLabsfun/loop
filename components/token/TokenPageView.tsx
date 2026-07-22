import { notFound } from "next/navigation";
import { TokenPage } from "./TokenPage";
import { getProject } from "@/lib/queries";
import { getTokenView } from "@/lib/token-market";
import { getSolUsd } from "@/lib/price";
import { getRecentCommits } from "@/lib/commits";
import { getAgentState, getChat } from "@/lib/agent-data";
import { anthropicComputeSummary } from "@/lib/anthropic-cost";
import { getComputeLedger } from "@/lib/compute-ledger-store";
import { getFeeLedger } from "@/lib/fee-ledger-store";
import { getVercelVisitorsTotal } from "@/lib/vercel-analytics";
import { chainsOf, homeChain, isLiveOn, projectOnChain } from "@/lib/chains/deployments";
import { isChain, type Chain } from "@/lib/chains/types";

// Shared server-side data load + render for the public token page (/token).

// Window for "since launch" metrics (Claude spend + Vercel visitors). Snaps to
// the LOOP token's creation day; overridable so other deployments can retarget.
const SINCE_ISO = process.env.ANTHROPIC_COST_SINCE || "2026-06-16T00:00:00Z";

/**
 * A project is ONE thing under ONE slug — one agent, one backlog, one repo —
 * that can be funded on several chains. `chain` selects WHICH deployment's
 * market side to render (token, treasury, chart, trades, swap); everything
 * identity-shaped (agent state, chat, commits, fee ledger) is read from the
 * project itself and is the same whichever chain you're viewing. An unknown
 * chain, or one the project isn't deployed on, falls back to its home chain.
 */
export async function TokenPageView({
  projectKey,
  chain,
}: {
  projectKey: string;
  chain?: string;
}) {
  const base = (await getProject(projectKey)) ?? (await getProject("loop"));
  if (!base) notFound();
  const requested = isChain(chain) ? chain : null;
  const viewChain: Chain = requested && isLiveOn(base, requested) ? requested : homeChain(base);
  // The project AS SEEN FROM the viewed chain: market side swapped, identity
  // untouched. Identity-shaped reads below deliberately keep using `base`.
  const onChain = projectOnChain(base, viewChain);
  // Compute (Claude spend) is org-wide and visitors are site-wide, so both are
  // only meaningful on the official project; fetch them only there.
  const [view, solUsd, commitsAll, agentState, chat, computeApi, computeLedger, feeLedger, visitors] =
    await Promise.all([
      getTokenView(onChain),
      getSolUsd(),
      getRecentCommits(base.repo, 30),
      getAgentState(base),
      getChat(base.key),
      base.official ? anthropicComputeSummary() : Promise.resolve(null),
      base.official ? getComputeLedger(base.key) : Promise.resolve(null),
      getFeeLedger(base.key),
      base.official ? getVercelVisitorsTotal(SINCE_ISO) : Promise.resolve(null),
    ]);
  // Prefer the Admin Cost API; fall back to the metered compute_ledger row.
  const compute =
    computeApi ??
    (computeLedger && computeLedger.consumedUsd > 0
      ? {
          spentUsd: computeLedger.consumedUsd,
          sinceISO: SINCE_ISO,
          // No Anthropic balance API for an individual account ⇒ the manual ledger
          // can't track real "remaining"; publish only best-effort cumulative spend.
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
      viewChain={viewChain}
      deployedChains={chainsOf(base)}
    />
  );
}
