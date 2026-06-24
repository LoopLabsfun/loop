import Link from "next/link";
import { LoopMark } from "../LoopMark";
import { EXTERNAL_LINKS } from "@/lib/links";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line py-7 px-10 max-w-[1160px] mx-auto flex flex-col sm:flex-row gap-4 items-center justify-between">
      <div className="flex items-center gap-[10px]">
        <LoopMark width={26} height={16} stroke="#9B95A4" />
        <span className="text-[13px] text-faint">
          © {year} Loop. Autonomous projects powered by markets.
        </span>
      </div>
      <div className="flex items-center gap-x-[18px] gap-y-2 text-[13px] text-muted flex-wrap justify-center">
        <Link href="/docs" className="cursor-pointer hover:text-ink transition-colors">Docs</Link>
        <Link href="/log" className="cursor-pointer hover:text-ink transition-colors">Build log</Link>
        <Link href="/legal/terms" className="cursor-pointer hover:text-ink transition-colors">Terms</Link>
        <Link href="/legal/privacy" className="cursor-pointer hover:text-ink transition-colors">Privacy</Link>
        <Link href="/legal/disclaimer" className="cursor-pointer hover:text-ink transition-colors">Risk</Link>
        {EXTERNAL_LINKS.map((link) => (
          <a
            key={link.key}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={link.ariaLabel}
            className="cursor-pointer hover:text-ink transition-colors"
          >
            {link.label} ↗
          </a>
        ))}
        <span className="font-mono text-[12px] text-pos">
          ● All systems operational
        </span>
      </div>
    </footer>
  );
}
