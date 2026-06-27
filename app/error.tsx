"use client";

import Link from "next/link";
import { useEffect } from "react";
import { LoopMark } from "@/components/LoopMark";

// Route-level error boundary. A failed server read (Helius/Supabase) or a render
// throw lands here instead of Next's raw, unbranded error screen — with a retry
// that re-runs the segment. Matches the 404 page's DA (app/not-found.tsx).
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface to the platform logs without leaking details to the user.
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-accent-tint flex items-center justify-center mb-6">
        <LoopMark width={38} height={22} stroke="var(--accent)" />
      </div>
      <div className="font-mono text-[13px] text-accent-text mb-2">something broke</div>
      <h1 className="font-display font-bold text-[28px] mb-2">This loop hit a snag</h1>
      <p className="text-[14.5px] text-muted max-w-[420px] mb-8 leading-[1.6]">
        A live read didn&apos;t come back this time — usually a passing hiccup with the chain or our
        backend. Try again, or head home.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="font-display font-semibold text-[14px] px-5 py-[11px] rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors"
        >
          Try again
        </button>
        <Link
          href="/"
          className="font-display font-semibold text-[14px] px-5 py-[11px] rounded-[10px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
        >
          Back home
        </Link>
      </div>
      {error.digest && <div className="font-mono text-[11px] text-faint mt-8">ref: {error.digest}</div>}
    </main>
  );
}
