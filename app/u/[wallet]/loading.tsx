import { LoopMark } from "@/components/LoopMark";

// Suspense fallback for a profile while its on-chain positions + social reads
// resolve — a branded skeleton instead of a blank screen.
function Block({ className = "" }: { className?: string }) {
  return <div className={`rounded-[10px] bg-surface-2 animate-pulse ${className}`} />;
}

export default function ProfileLoading() {
  return (
    <div className="min-h-screen">
      <nav className="border-b border-line max-w-[1280px] mx-auto px-6 sm:px-8 h-[60px] flex items-center justify-between">
        <div className="flex items-center gap-[10px]">
          <LoopMark width={24} height={15} stroke="var(--accent)" />
          <span className="font-display font-bold text-[16px] tracking-[-0.02em]">Loop</span>
        </div>
        <Block className="w-[110px] h-[34px]" />
      </nav>

      <main className="max-w-[920px] mx-auto px-6 sm:px-8 py-7 flex flex-col gap-4">
        {/* Identity card */}
        <div className="bg-surface border border-line-2 rounded-[18px] overflow-hidden">
          <div className="h-[88px] bg-surface-2 animate-pulse" />
          <div className="px-6 pb-5">
            <div className="-mt-[34px] flex items-end justify-between">
              <Block className="w-[76px] h-[76px] rounded-[22px] ring-4 ring-surface" />
              <Block className="w-[96px] h-[36px]" />
            </div>
            <Block className="w-[200px] h-[24px] mt-3" />
            <Block className="w-[150px] h-[14px] mt-3" />
            <div className="flex gap-2 mt-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Block key={i} className="w-[88px] h-[24px]" />
              ))}
            </div>
          </div>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-2 gap-3">
          <Block className="h-[68px] rounded-[14px]" />
          <Block className="h-[68px] rounded-[14px]" />
        </div>

        {/* Panels */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Block className="h-[200px] rounded-[16px]" />
          <Block className="h-[200px] rounded-[16px]" />
        </div>
      </main>
    </div>
  );
}
