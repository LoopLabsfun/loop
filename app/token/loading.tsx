import { LoopMark } from "@/components/LoopMark";

// Suspense fallback for the token page while its live on-chain reads resolve, so
// a slow Helius/market fetch shows a branded skeleton instead of a blank screen.
function Block({ className = "" }: { className?: string }) {
  return <div className={`rounded-[10px] bg-surface-2 animate-pulse ${className}`} />;
}

export default function TokenLoading() {
  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 flex items-center justify-between gap-2 px-4 sm:px-8 py-[14px] bg-canvas/[0.88] backdrop-blur-md border-b border-line">
        <div className="flex items-center gap-[10px]">
          <LoopMark width={30} height={18} />
          <span className="font-display font-bold text-[19px] tracking-[-0.02em]">Loop</span>
          <span className="text-line-hover">/</span>
          <Block className="w-[56px] h-[16px]" />
        </div>
        <Block className="w-[120px] h-[36px]" />
      </nav>

      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-7 pb-5">
        <div className="bg-surface border border-line-2 rounded-[16px] px-6 py-5 grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-[10px]">
              <Block className="w-[42px] h-[42px] rounded-[12px]" />
              <Block className="w-[140px] h-[26px]" />
            </div>
            <Block className="w-[220px] h-[14px]" />
            <Block className="w-[160px] h-[34px] mt-2" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Block key={i} className="h-[40px]" />
              ))}
            </div>
            <Block className="h-[44px] mt-3" />
          </div>
          <div className="flex flex-col gap-3 border-t border-line-2 pt-5 lg:border-t-0 lg:pt-0 lg:border-l lg:pl-6">
            <Block className="w-[120px] h-[16px]" />
            <Block className="h-[56px]" />
            <Block className="h-[72px]" />
            <Block className="h-[34px] mt-auto" />
          </div>
        </div>
      </section>

      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 pb-10">
        <Block className="h-[420px]" />
        <Block className="h-[420px]" />
      </section>
    </div>
  );
}
