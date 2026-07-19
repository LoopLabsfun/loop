"use client";

import { useState } from "react";
import { explorerUrl, shortAddr } from "@/lib/format";
import type { Network } from "@/lib/types";
import type { Chain } from "@/lib/chains/types";

// The official LOOP contract address (CA), for the header. It auto-appears the
// moment LOOP is minted (the project row gets a `mint`); before that it shows a
// subtle reserved placeholder so the spot exists. Chain-aware: on Hood it links
// to Blockscout and the pre-launch placeholder reads "coming to Hood". Click to
// copy; ↗ opens the explorer. Pass `mint={null}` (pre-launch) for the placeholder.
export function LoopContract({
  mint,
  network = "mainnet",
  chain = "solana",
  className = "",
}: {
  mint?: string | null;
  network?: Network;
  chain?: Chain;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!mint) {
    const label = chain === "hood" ? "CA · coming to Hood" : "CA · at mainnet";
    return (
      <span
        title={
          chain === "hood"
            ? "The official $LOOP contract on Hood (Robinhood Chain) appears here once LOOP relaunches there."
            : "The official $LOOP contract address appears here once LOOP is live on mainnet."
        }
        className={`font-mono text-[11.5px] text-faint border border-line-3 rounded-[8px] px-[10px] py-[6px] whitespace-nowrap ${className}`}
      >
        {label}
      </span>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <span
      className={`inline-flex items-center gap-[7px] font-mono text-[11.5px] border border-line-3 rounded-[8px] pl-[10px] pr-[7px] py-[5px] bg-surface whitespace-nowrap ${className}`}
    >
      <button
        onClick={copy}
        title="Copy the official $LOOP contract address"
        className="inline-flex items-center gap-[6px] text-ink hover:text-accent-text transition-colors"
      >
        <span className="text-faint">CA</span>
        {copied ? (
          <span className="text-pos">✓ copied</span>
        ) : (
          <span>{shortAddr(mint)}</span>
        )}
      </button>
      <a
        href={explorerUrl(mint, network, chain)}
        target="_blank"
        rel="noopener noreferrer"
        title="View on explorer"
        className="text-accent-text hover:text-accent-d transition-colors"
      >
        ↗
      </a>
    </span>
  );
}
