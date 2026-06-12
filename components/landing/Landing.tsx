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

export function Landing({ projects }: { projects: Project[] }) {
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
      <Nav onLaunch={openModal} onScroll={scrollTo} />
      <Hero engine={engine} onLaunch={openModal} onScroll={scrollTo} />
      <LiveProjects projects={projects} loopBalance={engine.balance} />
      <HowAndTreasury engine={engine} />
      <LoopMarquee />
      <Tokenomics />
      <UseCases />
      <CTA onLaunch={openModal} />
      <Footer />
      <LaunchModal open={modalOpen} onClose={closeModal} />
    </>
  );
}
