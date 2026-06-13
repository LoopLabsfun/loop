import Link from "next/link";
import { LoopMark } from "../LoopMark";

export function Footer() {
  return (
    <footer className="border-t border-line py-7 px-10 max-w-[1160px] mx-auto flex flex-col sm:flex-row gap-4 items-center justify-between">
      <div className="flex items-center gap-[10px]">
        <LoopMark width={26} height={16} stroke="#9B95A4" />
        <span className="text-[13px] text-faint">
          © 2026 Loop. Autonomous projects powered by markets.
        </span>
      </div>
      <div className="flex items-center gap-[22px] text-[13px] text-muted">
        <Link href="/docs" className="cursor-pointer hover:text-ink transition-colors">Docs</Link>
        <a
          href="https://github.com/godisrupt/loop-fun"
          target="_blank"
          rel="noopener noreferrer"
          className="cursor-pointer hover:text-ink transition-colors"
        >
          GitHub ↗
        </a>
        <span className="font-mono text-[12px] text-pos">
          ● All systems operational
        </span>
      </div>
    </footer>
  );
}
