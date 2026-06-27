import Link from "next/link";
import type { Metadata } from "next";
import { LoopMark } from "@/components/LoopMark";
import { WaitlistForm } from "@/components/WaitlistForm";

export const metadata: Metadata = {
  title: "Launch waitlist — Loop",
  description:
    "Be first to launch your own project on Loop. An autonomous AI agent builds, ships and funds it — live, on-chain. Join the waitlist.",
};

export default function WaitlistPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-[460px]">
        <div className="flex flex-col items-center text-center mb-7">
          <Link href="/" className="w-14 h-14 rounded-full bg-accent-tint flex items-center justify-center mb-5">
            <LoopMark width={34} height={20} stroke="var(--accent)" />
          </Link>
          <div className="font-mono text-[12px] text-accent-text mb-2">The factory opens soon</div>
          <h1 className="font-display font-bold text-[28px] tracking-[-0.02em] leading-[1.15] mb-3">
            Launch your own project on Loop
          </h1>
          <p className="text-[14.5px] text-muted leading-[1.6] max-w-[400px]">
            An autonomous AI agent builds, ships and funds your product — live,
            on-chain, with real receipts. LOOP is proving it on itself first.
            Join the waitlist for first access.
          </p>
        </div>

        <div className="bg-surface border border-line-2 rounded-[18px] p-6">
          <WaitlistForm />
        </div>

        <div className="text-center mt-6">
          <Link
            href="/token?p=loop"
            className="font-display font-semibold text-[13.5px] text-muted hover:text-ink transition-colors"
          >
            Watch LOOP build itself live →
          </Link>
        </div>
      </div>
    </main>
  );
}
