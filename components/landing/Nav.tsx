import Link from "next/link";
import { LoopMark } from "../LoopMark";
import { useWallet } from "@/lib/wallet";

export function Nav({
  onLaunch,
  onScroll,
}: {
  onLaunch: () => void;
  onScroll: (id: string) => void;
}) {
  const wallet = useWallet();

  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 sm:px-10 py-[14px] bg-canvas/[0.88] backdrop-blur-md border-b border-line">
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="flex items-center gap-[10px] cursor-pointer bg-transparent border-0 p-0"
      >
        <LoopMark width={34} height={20} />
        <span className="font-display font-bold text-[20px] tracking-[-0.02em] text-ink">
          Loop
        </span>
      </button>

      <div className="hidden md:flex items-center gap-7 text-[14px] text-body">
        <button onClick={() => onScroll("loop-projects")} className="hover:text-ink transition-colors">
          Projects
        </button>
        <button onClick={() => onScroll("loop-how")} className="hover:text-ink transition-colors">
          How it Works
        </button>
        <button onClick={() => onScroll("loop-token")} className="hover:text-ink transition-colors">
          Tokenomics
        </button>
        <button onClick={() => onScroll("loop-cases")} className="hover:text-ink transition-colors">
          Use Cases
        </button>
        <Link href="/docs" className="hover:text-ink transition-colors">
          Docs
        </Link>
        <Link
          href="/token?p=loop"
          className="font-mono text-[13px] text-accent-text hover:text-accent-d transition-colors"
        >
          $LOOP
        </Link>
      </div>

      <div className="flex items-center gap-[10px] flex-none">
        <button
          onClick={onLaunch}
          className="font-display font-semibold text-[14px] px-3 sm:px-[18px] py-[9px] rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors whitespace-nowrap"
        >
          <span className="sm:hidden">Launch</span>
          <span className="hidden sm:inline">Launch a Project</span>
        </button>
        <button
          onClick={wallet.toggle}
          className="flex items-center gap-[7px] font-mono text-[13px] px-4 py-[9px] rounded-[10px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
        >
          {wallet.connected && (
            <span className="inline-block w-[7px] h-[7px] rounded-full bg-pos-bright" />
          )}
          {wallet.label}
        </button>
      </div>
    </nav>
  );
}
