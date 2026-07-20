"use client";

import { useState } from "react";
import Link from "next/link";
import { LoopMark } from "../LoopMark";
import { LoopContract } from "../LoopContract";
import { GitHubIcon, XIcon, TelegramIcon, DiscordIcon } from "../AuthIcons";
import { NavUserActions } from "../NavUserActions";
import { ChainSwitch } from "../ChainSwitch";
import { ChainWalletButton } from "../ChainWalletButton";
import { useWallet } from "@/lib/wallet";
import { useChain } from "@/lib/chains/chain-context";
import { EXTERNAL_LINKS } from "@/lib/links";
import type { Network } from "@/lib/types";

const SECTIONS: { id: string; label: string }[] = [
  { id: "loop-projects", label: "Projects" },
  { id: "loop-how", label: "How it Works" },
  { id: "loop-cases", label: "Use Cases" },
];

const COMMUNITY_ICONS: Record<string, JSX.Element> = {
  github: <GitHubIcon size={18} />,
  x: <XIcon size={16} />,
  telegram: <TelegramIcon size={18} />,
  discord: <DiscordIcon size={18} />,
};

export function Nav({
  onLaunch,
  onScroll,
  loopMint,
  loopNetwork,
}: {
  onLaunch: () => void;
  onScroll: (id: string) => void;
  /** Official $LOOP mint (CA) once live on mainnet; null pre-launch. */
  loopMint?: string | null;
  loopNetwork?: Network;
}) {
  const wallet = useWallet();
  const { chain } = useChain();
  const [menuOpen, setMenuOpen] = useState(false);

  // The header CA follows the active chain: on Solana it's the $LOOP mint; on
  // Hood it's the relaunched $LOOP ERC-20 (NEXT_PUBLIC_HOOD_LOOP_MINT, null until
  // launched → the "coming to Hood" placeholder).
  const caMint =
    chain === "hood"
      ? process.env.NEXT_PUBLIC_HOOD_LOOP_MINT || null
      : loopMint;

  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 sm:px-10 py-[14px] bg-canvas/[0.88] backdrop-blur-md border-b border-line">
      {/* Left group: logo + menu (left-aligned) */}
      <div className="flex items-center gap-7 lg:gap-9 min-w-0">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="flex items-center gap-[10px] cursor-pointer bg-transparent border-0 p-0 flex-none"
        >
          <LoopMark width={34} height={20} />
          <span className="font-display font-bold text-[20px] tracking-[-0.02em] text-ink">
            Loop
          </span>
        </button>

        <div className="hidden md:flex items-center gap-7 text-[14px] text-body">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => onScroll(s.id)}
              className="hover:text-ink transition-colors"
            >
              {s.label}
            </button>
          ))}
          <Link href="/explore" className="hover:text-ink transition-colors">
            Explore
          </Link>
          <Link href="/activity" className="hover:text-ink transition-colors">
            Activity
          </Link>
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
      </div>

      <div className="flex items-center gap-[10px] flex-none">
        {/* Official $LOOP CA — auto-appears at mainnet, reserved spot before */}
        <LoopContract
          mint={caMint}
          network={loopNetwork}
          chain={chain}
          className="hidden lg:inline-flex"
        />
        <ChainSwitch className="flex" />
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          className="md:hidden w-[38px] h-[38px] flex-none flex items-center justify-center rounded-[10px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            {menuOpen ? (
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M2 4h12M2 8h12M2 12h12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
        <button
          onClick={onLaunch}
          className="font-display font-semibold text-[14px] px-3 sm:px-[18px] py-[9px] rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors whitespace-nowrap"
        >
          <span className="sm:hidden">Launch</span>
          <span className="hidden sm:inline">Launch a Project</span>
        </button>
        <NavUserActions messagesHidden />
        <ChainWalletButton
          solConnected={wallet.connected}
          solLabel={wallet.label}
          onSolToggle={wallet.toggle}
        />
      </div>

      {menuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-canvas border-b border-line shadow-[0_12px_28px_-16px_rgba(22,19,26,0.18)] flex flex-col px-4 py-2 animate-fadeInFast">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setMenuOpen(false);
                onScroll(s.id);
              }}
              className="text-left text-[15px] text-body py-[11px] border-b border-line-2 hover:text-ink transition-colors"
            >
              {s.label}
            </button>
          ))}
          <Link
            href="/explore"
            onClick={() => setMenuOpen(false)}
            className="text-[15px] text-body py-[11px] border-b border-line-2 hover:text-ink transition-colors"
          >
            Explore
          </Link>
          <Link
            href="/activity"
            onClick={() => setMenuOpen(false)}
            className="text-[15px] text-body py-[11px] border-b border-line-2 hover:text-ink transition-colors"
          >
            Activity
          </Link>
          <Link
            href="/docs"
            onClick={() => setMenuOpen(false)}
            className="text-[15px] text-body py-[11px] border-b border-line-2 hover:text-ink transition-colors"
          >
            Docs
          </Link>
          {wallet.connected && (
            <>
              <Link
                href="/messages"
                onClick={() => setMenuOpen(false)}
                className="text-[15px] text-body py-[11px] border-b border-line-2 hover:text-ink transition-colors"
              >
                Messages
              </Link>
              <Link
                href="/profile"
                onClick={() => setMenuOpen(false)}
                className="text-[15px] text-body py-[11px] border-b border-line-2 hover:text-ink transition-colors"
              >
                My profile
              </Link>
            </>
          )}
          <Link
            href="/token?p=loop"
            onClick={() => setMenuOpen(false)}
            className="font-mono text-[14px] text-accent-text py-[11px] hover:text-accent-d transition-colors"
          >
            $LOOP
          </Link>
          <div className="flex items-center justify-between py-[11px]">
            <span className="text-[15px] text-body">$LOOP contract</span>
            <LoopContract mint={caMint} network={loopNetwork} chain={chain} />
          </div>
          <div className="flex items-center justify-between py-[11px] border-t border-line-2">
            <span className="text-[15px] text-body">Chain</span>
            <ChainSwitch className="flex" />
          </div>
          <div className="flex items-center gap-5 py-[11px] border-t border-line-2">
            {EXTERNAL_LINKS.map((link) => {
              const icon = COMMUNITY_ICONS[link.key];
              if (!icon) return null;
              return (
                <a
                  key={link.key}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={link.ariaLabel}
                  className="text-muted hover:text-ink transition-colors"
                >
                  {icon}
                </a>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
