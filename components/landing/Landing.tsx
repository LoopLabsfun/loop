"use client";

import { useCallback, useState } from "react";
import { Nav } from "./Nav";
import { Hero } from "./Hero";
import { LiveProjects } from "./LiveProjects";
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

export function Landing({
  projects,
  solUsd,
  agentActive = false,
  activeByKey = {},
  commits = [],
  matchCommits,
  agentTasks = [],
  agentLive = false,
}: {
  projects: Project[];
  solUsd: number;
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
}) {
  const loop = projects.find((p) => p.key === "loop");
  const engine = useLoopEngine(loop?.treasurySol);
  const [modalOpen, setModalOpen] = useState(false);
  const currentTask = agentTasks.find((t) => t.status === "building");

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  const body = (
    <>
      <Nav
        onLaunch={openModal}
        onScroll={scrollTo}
        loopMint={loop?.mint}
        loopNetwork={loop?.network}
      />
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
          agentActive={agentActive}
          currentTask={currentTask}
          onLaunch={openModal}
          onScroll={scrollTo}
        />
        <LiveProjects projects={projects} solUsd={solUsd} activeByKey={activeByKey} />
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
