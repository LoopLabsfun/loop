"use client";

import { useCallback, useState } from "react";
import { Nav } from "./Nav";
import { Hero } from "./Hero";
import { LiveProjects } from "./LiveProjects";
import { HowAndTreasury } from "./HowAndTreasury";
import { LoopMarquee } from "./LoopMarquee";
import { Tokenomics } from "./Tokenomics";
import { UseCases } from "./UseCases";
import { CTA } from "./CTA";
import { Footer } from "./Footer";
import { LaunchModal } from "./LaunchModal";
import { useLoopEngine } from "@/lib/useLoopEngine";
import type { Project } from "@/lib/types";

export function Landing({
  projects,
  solUsd,
}: {
  projects: Project[];
  solUsd: number;
}) {
  const loop = projects.find((p) => p.key === "loop");
  const engine = useLoopEngine(loop?.treasurySol);
  const [modalOpen, setModalOpen] = useState(false);

  const scrollTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  return (
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
          onLaunch={openModal}
          onScroll={scrollTo}
        />
        <LiveProjects projects={projects} loopBalance={engine.balance} />
        <HowAndTreasury engine={engine} />
        <LoopMarquee />
        <Tokenomics />
        <UseCases />
        <CTA onLaunch={openModal} />
      </main>
      <Footer />
      <LaunchModal open={modalOpen} onClose={closeModal} />
    </>
  );
}
