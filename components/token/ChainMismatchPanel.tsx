"use client";

import Link from "next/link";
import { LoopMark } from "../LoopMark";
import { HoodMark } from "../HoodMark";
import { chainInfo } from "@/lib/chains/registry";
import type { Chain } from "@/lib/chains/types";
import type { Project } from "@/lib/types";

// Rendered by TokenPage when the project has NO deployment on the header's
// active chain, INSTEAD of the market panels — a Solana chart/trades under a
// "Hood" header would read as live Hood data, which it isn't. Note this is now
// about a missing DEPLOYMENT, not a different project: a project live on both
// chains never lands here, it just swaps its market side (lib/chains/deployments).
// Official LOOP on Hood gets the pre-relaunch "coming soon" framing (mirrors the
// landing card); everything else gets an honest "this project lives on X".
export function ChainMismatchPanel({
  project: p,
  activeChain,
  onSwitchBack,
}: {
  project: Project;
  activeChain: Chain;
  onSwitchBack: () => void;
}) {
  const projectChain: Chain = p.chain ?? "solana";
  const active = chainInfo(activeChain);
  const home = chainInfo(projectChain);
  // No env gate needed any more: this panel only renders when the project has
  // no deployment on `activeChain` at all, so "coming soon" is simply true.
  const loopComingToHood = p.key === "loop" && activeChain === "hood";

  return (
    <section className="max-w-[640px] mx-auto px-8 py-16">
      <div className="bg-surface border-[1.5px] border-accent-300 rounded-[16px] p-8 text-center">
        <div className="flex items-center justify-center gap-3 mb-5">
          <div className="w-[52px] h-[52px] rounded-[14px] border border-line-2 bg-accent-tint flex items-center justify-center">
            <LoopMark width={30} height={18} stroke="var(--accent)" />
          </div>
          {activeChain === "hood" && (
            <>
              <span className="text-faint font-mono text-[16px]">→</span>
              <div className="w-[52px] h-[52px] rounded-[14px] border border-line-2 bg-canvas flex items-center justify-center">
                <HoodMark size={28} />
              </div>
            </>
          )}
        </div>

        {loopComingToHood ? (
          <>
            <h2 className="font-display font-bold text-[22px] tracking-[-0.02em] m-0 mb-2">
              $LOOP is coming to Robinhood Chain
            </h2>
            <p className="text-[13.5px] text-muted leading-[1.6] m-0 mb-6 max-w-[440px] mx-auto">
              One project, one agent, one treasury — soon funded by two markets.
              The chart and trading you know from Solana will light up here the
              moment $LOOP goes live on Hood.
            </p>
          </>
        ) : (
          <>
            <h2 className="font-display font-bold text-[22px] tracking-[-0.02em] m-0 mb-2">
              {p.ticker} lives on {home.label}
            </h2>
            <p className="text-[13.5px] text-muted leading-[1.6] m-0 mb-6 max-w-[440px] mx-auto">
              Your header is set to {active.label}, but this project trades on{" "}
              {home.label} — its chart, trades and treasury are {home.label}{" "}
              data. Switch back to see the live market, or browse what&apos;s on{" "}
              {active.label}.
            </p>
          </>
        )}

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <button
            onClick={onSwitchBack}
            className="font-mono text-[12.5px] px-4 py-[9px] rounded-[10px] bg-accent text-white hover:opacity-90 transition-opacity"
          >
            View {p.ticker} on {home.label}
          </button>
          <Link
            href="/"
            className="font-mono text-[12.5px] px-4 py-[9px] rounded-[10px] border border-line-3 text-muted hover:text-ink transition-colors no-underline"
          >
            Browse {active.label} projects
          </Link>
        </div>

        {loopComingToHood && (
          <div className="mt-6 pt-4 border-t border-line-4 font-mono text-[11px] text-faint">
            CA · coming to Hood
          </div>
        )}
      </div>
    </section>
  );
}
