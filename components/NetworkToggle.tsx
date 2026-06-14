"use client";

import { useNetwork } from "@/lib/network";

/**
 * Devnet/mainnet switch. Toggles the session cluster (wallet connection +
 * where new launches mint). Devnet is styled in the warn color so it's obvious
 * you're in test mode.
 */
export function NetworkToggle({ className }: { className?: string }) {
  const { network, toggle } = useNetwork();
  const devnet = network === "devnet";

  return (
    <button
      onClick={toggle}
      title={`Network: ${network} — click to switch to ${devnet ? "mainnet" : "devnet"}`}
      aria-label={`Network ${network}. Switch to ${devnet ? "mainnet" : "devnet"}.`}
      className={`flex items-center gap-[6px] font-mono text-[12px] px-[11px] py-[9px] rounded-[10px] border transition-colors whitespace-nowrap ${
        devnet
          ? "border-warn text-warn"
          : "border-line-3 bg-surface text-muted hover:border-line-hover"
      } ${className ?? ""}`}
    >
      <span
        className={`inline-block w-[7px] h-[7px] rounded-full ${
          devnet ? "bg-warn" : "bg-pos-bright"
        }`}
      />
      {network}
    </button>
  );
}
