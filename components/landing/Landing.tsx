"use client";

import { useCallback, useEffect, useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { Hero } from "./Hero";
import { LiveProjects } from "./LiveProjects";
import { PrelaunchBoard } from "./PrelaunchBoard";
import { HowAndTreasury } from "./HowAndTreasury";
import { LoopMarquee } from "./LoopMarquee";
import { UseCases } from "./UseCases";
import { CTA } from "./CTA";
import { Footer } from "./Footer";
import { LaunchModal } from "./LaunchModal";
import { InspectorDrawer } from "@/components/token/InspectorDrawer";
import { InspectorProvider } from "@/lib/inspector";
import { useLoopEngine } from "@/lib/useLoopEngine";
import type { Project } from "@/lib/types";
import type { AgentTask } from "@/lib/agent";
import type { PublicPrelaunch } from "@/lib/prelaunch-public";
import type { XStockHolding } from "@/lib/xstocks-holdings";

export function Landing({
  projects,
  solUsd,
  prelaunches = [],
  agentActive = false,
  activeByKey = {},
  commits = [],
  matchCommits,
  agentTasks = [],
  agentLive = false,
  treasuryHoldings = [],
}: {
  projects: Project[];
  solUsd: number;
  /** Curated pre-launches for the home board (the "vote with SOL" social layer). */
  prelaunches?: PublicPrelaunch[];
  /** True when the LOOP agent ticked recently — drives the live Runtime status. */
  agentActive?: boolean;
  /** Real "agent ticked recently" per project key — drives each card's status. */
  activeByKey?: Record<string, boolean>;
  /** Real recent commits for the LOOP repo (newest first), server-fetched. */
  commits?: { hash: string; msg: string }[];
  /** Wider commit window to link shipped LIVE-LOG rows to their commit. */
  matchCommits?: { hash: string; msg: string }[];
  /** The LOOP agent's real tasks for the home loop-engine LIVE LOG. */
  agentTasks?: AgentTask[];
  /** Whether the LOOP agent has real activity (LIVE LOG indicator). */
  agentLive?: boolean;
  /** Live xStocks positions held by the LOOP treasury wallet. */
  treasuryHoldings?: XStockHolding[];
}) {
  const loop = projects.find((p) => p.key === "loop");
  const engine = useLoopEngine(loop?.treasurySol);
  const [modalOpen, setModalOpen] = useState(false);
  const currentTask = agentTasks.find((t) => t.status === "building");
  const shippedCount = agentTasks.filter((t) => t.status === "shipped").length;

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  // Deep-link for the shared header's Launch CTA on other pages: /?launch=1
  // opens the modal on arrival. Read off window (not useSearchParams) to skip
  // the Suspense-boundary requirement.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("launch") === "1") setModalOpen(true);
  }, []);

  const body = (
    <>
      <SiteHeader onLaunch={openModal} />
      <main>
        <Hero
          engine={engine}
          solUsd={solUsd}
          launched={!!loop?.mint}
          network={loop?.network}
          ticker={loop?.ticker}
          treasuryToken={loop?.treasuryTokenUi ?? 0}
          treasuryTokenUsd={(loop?.treasuryTokenUi ?? 0) * (loop?.price ?? 0)}
          treasuryHistory={loop?.treasuryHistory ?? undefined}
          treasuryHoldings={treasuryHoldings}
          agentActive={agentActive}
          currentTask={currentTask}
          shippedCount={shippedCount}
          onLaunch={openModal}
          onScroll={scrollTo}
        />
        <LiveProjects projects={projects} solUsd={solUsd} activeByKey={activeByKey} />
        <PrelaunchBoard prelaunches={prelaunches} onLaunch={openModal} />
        <HowAndTreasury
          project={loop}
          solUsd={solUsd}
          agentActive={agentActive}
          launched={!!loop?.mint}
          commits={commits}
          matchCommits={matchCommits}
          tasks={agentTasks}
          agentLive={agentLive}
        />
        <LoopMarquee />
        <UseCases />
        <CTA onLaunch={openModal} />
      </main>
      <Footer />
      <LaunchModal open={modalOpen} onClose={closeModal} />
    </>
  );

  // The right-side inspector drawer is shared with the token page; on the home it
  // makes the live-treasury stats + real claims click-to-inspect. Needs a project
  // for context (ticker/network) — wrap only when LOOP is resolved.
  return loop ? (
    <InspectorProvider project={loop}>
      {body}
      <InspectorDrawer />
    </InspectorProvider>
  ) : (
    body
  );
}
