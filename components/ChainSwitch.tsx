"use client";

import { useChain } from "@/lib/chains/chain-context";
import { chainInfo } from "@/lib/chains/registry";
import { CHAINS } from "@/lib/chains/types";
import { HoodMark } from "./HoodMark";
import { SolMark } from "./SolMark";

/**
 * The header's Solana / Hood segmented switch. Sets the app-wide chain mode
 * (lib/chains/chain-context.tsx): which projects the landing lists and which
 * chain launches target. Rendered in the landing Nav and the token-page nav.
 */
export function ChainSwitch({ className = "" }: { className?: string }) {
  const { chain, setChain } = useChain();
  return (
    <div
      role="group"
      aria-label="Active chain"
      className={`items-center p-[3px] rounded-[10px] border border-line-3 bg-surface ${className}`}
    >
      {CHAINS.map((c) => {
        const active = c === chain;
        return (
          <button
            key={c}
            onClick={() => setChain(c)}
            aria-pressed={active}
            className={`inline-flex items-center gap-[5px] font-mono text-[11.5px] px-[10px] py-[5px] rounded-[8px] transition-colors whitespace-nowrap ${
              active
                ? "bg-accent text-white"
                : "text-muted hover:text-ink"
            }`}
          >
            {c === "hood" ? <HoodMark size={12} /> : <SolMark size={12} />}
            {chainInfo(c).label}
          </button>
        );
      })}
    </div>
  );
}
