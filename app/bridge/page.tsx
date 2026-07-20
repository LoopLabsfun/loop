import type { Metadata } from "next";
import Link from "next/link";
import { LoopMark } from "@/components/LoopMark";
import { SwapWidget } from "@/components/swap/SwapWidget";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Swap — Loop",
  description: "Swap any token between Solana and Robinhood Chain (Hood), in-app via Relay.",
};

export default function BridgePage() {
  return (
    <div className="min-h-screen">
      <nav className="border-b border-line max-w-[1280px] mx-auto px-6 sm:px-8 h-[60px] flex items-center">
        <Link href="/" className="flex items-center gap-[10px]">
          <LoopMark width={24} height={15} stroke="var(--accent)" />
          <span className="font-display font-bold text-[16px] tracking-[-0.02em]">Loop</span>
        </Link>
      </nav>

      <main className="max-w-[560px] mx-auto px-6 sm:px-8 py-8 flex flex-col items-center">
        <div className="text-center mb-6">
          <h1 className="font-display font-bold text-[26px] tracking-[-0.02em] m-0">
            Swap Solana ↔ Hood
          </h1>
          <p className="text-[13.5px] text-muted mt-2 mb-0 max-w-[420px] mx-auto leading-[1.55]">
            One idea, two markets. Swap any token between Solana and Robinhood
            Chain — quoted and executed in-app with your own wallets, never
            custodial.
          </p>
        </div>
        <SwapWidget />
      </main>
    </div>
  );
}
