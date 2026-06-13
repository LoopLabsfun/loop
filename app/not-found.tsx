import Link from "next/link";
import { LoopMark } from "@/components/LoopMark";

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-accent-tint flex items-center justify-center mb-6">
        <LoopMark width={38} height={22} stroke="var(--accent)" />
      </div>
      <div className="font-mono text-[13px] text-accent-text mb-2">404</div>
      <h1 className="font-display font-bold text-[28px] mb-2">
        This loop doesn&apos;t exist
      </h1>
      <p className="text-[14.5px] text-muted max-w-[420px] mb-8 leading-[1.6]">
        The page or project you&apos;re looking for isn&apos;t here. It may have
        never launched, or the link is off.
      </p>
      <div className="flex gap-3">
        <Link
          href="/"
          className="font-display font-semibold text-[14px] px-5 py-[11px] rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors"
        >
          Back home
        </Link>
        <Link
          href="/docs"
          className="font-display font-semibold text-[14px] px-5 py-[11px] rounded-[10px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
        >
          Read the Docs
        </Link>
      </div>
    </main>
  );
}
