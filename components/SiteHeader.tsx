"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LoopMark } from "./LoopMark";
import { NotificationBell } from "./NotificationBell";
import { ChainSwitch } from "./ChainSwitch";
import { ChainWalletButton } from "./ChainWalletButton";
import { GitHubIcon, XIcon, TelegramIcon, DiscordIcon, MessageIcon, ProfileIcon } from "./AuthIcons";
import { useWallet } from "@/lib/wallet";
import { EXTERNAL_LINKS } from "@/lib/links";

// ─────────────────────────────────────────────────────────────────────────────
// THE site header — one shared, sticky nav for every page (landing, token,
// explore, activity, swap, docs, …). Replaces the per-page ad-hoc navs so
// navigation never dead-ends: every surface carries the same four product
// links, the $LOOP pill, the Launch CTA, and the wallet cluster.
//
// Organization rules (the point of the redesign):
// - ≤4 nav links, so the full menu fits from md (768px) up — the hamburger is
//   a phone-only object, not a 13-inch-laptop one.
// - Landing-only scroll anchors (How it works, Use cases) are NOT nav: they
//   stay reachable on the landing page itself.
// - One primary CTA (Launch). The wallet button is the only other big control.
// - Connected extras (messages, profile, chain mode) fold into ONE avatar
//   menu; the notification bell stays standalone (time-sensitive).
// - The chain switch is demoted to icon-only in the bar (it must stay in the
//   bar: disconnected users need it to reach the Hood connect flow), with the
//   labeled version in the avatar menu and the mobile sheet.
// ─────────────────────────────────────────────────────────────────────────────

const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/explore", label: "Projects" },
  { href: "/activity", label: "Activity" },
  { href: "/bridge", label: "Swap" },
  { href: "/docs", label: "Docs" },
];

const COMMUNITY_ICONS: Record<string, JSX.Element> = {
  github: <GitHubIcon size={18} />,
  x: <XIcon size={16} />,
  telegram: <TelegramIcon size={18} />,
  discord: <DiscordIcon size={18} />,
};

export function SiteHeader({
  context,
  onLaunch,
  actions,
}: {
  /** Breadcrumb segment after "Loop /" — a ticker on token pages, a section
   *  name ("docs", "swap") elsewhere. Omit on the landing. */
  context?: string;
  /** Landing passes its modal opener; elsewhere the CTA deep-links to /?launch=1. */
  onLaunch?: () => void;
  /** Page-specific extra controls (e.g. the token page's Share button). */
  actions?: React.ReactNode;
}) {
  const wallet = useWallet();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const launchCls =
    "font-display font-semibold text-[14px] px-3 sm:px-4 py-[9px] rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors whitespace-nowrap";

  return (
    <nav className="sticky top-0 z-50 flex items-center gap-3 px-4 sm:px-8 py-[12px] bg-canvas/[0.88] backdrop-blur-md border-b border-line">
      {/* Logo + breadcrumb — pinned left */}
      <div className="flex items-center gap-[10px] min-w-0 flex-none max-w-[46%]">
        <Link href="/" className="flex items-center gap-[10px] text-ink flex-none">
          <LoopMark width={30} height={18} />
          <span className={`${context ? "hidden sm:inline" : ""} font-display font-bold text-[19px] tracking-[-0.02em]`}>
            Loop
          </span>
        </Link>
        {context && (
          <>
            <span className="hidden sm:inline text-line-hover">/</span>
            <span className="font-mono text-[13px] text-accent-text truncate">{context}</span>
          </>
        )}
      </div>

      {/* Product nav — absorbs all slack so the edges can never collide. Four
          links max is what lets it survive down to md instead of 1360px. */}
      <div className="flex-1 min-w-0 hidden md:flex items-center justify-center gap-6 text-[14px] text-body overflow-hidden">
        {NAV_LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap transition-colors hover:text-ink ${
              pathname === l.href ? "text-ink font-semibold" : ""
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>
      <div className="flex-1 md:hidden" />

      <div className="flex items-center gap-[8px] sm:gap-[10px] flex-none">
        {/* $LOOP — the platform token, one pill, always the token page. The CA
            itself lives (copyable) on that page, where it's actually needed. */}
        <Link
          href="/token?p=loop"
          className="hidden md:inline-flex items-center font-mono text-[12px] px-3 py-[6px] rounded-full bg-accent-tint border border-accent-tint-border text-accent-text hover:border-line-hover transition-colors whitespace-nowrap"
        >
          $LOOP
        </Link>

        {actions}

        <ChainSwitch labels="never" className="hidden sm:flex" />

        {onLaunch ? (
          <button onClick={onLaunch} className={launchCls}>
            Launch
          </button>
        ) : (
          <Link href="/?launch=1" className={launchCls}>
            Launch
          </Link>
        )}

        <NotificationBell />
        <ChainWalletButton
          solConnected={wallet.connected}
          solLabel={wallet.label}
          onSolToggle={wallet.toggle}
        />
        {wallet.connected && <UserMenu />}

        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          className="md:hidden w-[38px] h-[38px] flex-none flex items-center justify-center rounded-[10px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            {menuOpen ? (
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            ) : (
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile sheet */}
      {menuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-canvas border-b border-line shadow-[0_12px_28px_-16px_rgba(22,19,26,0.18)] flex flex-col px-4 py-2 animate-fadeInFast">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="text-[15px] text-body py-[11px] border-b border-line-2 hover:text-ink transition-colors"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/token?p=loop"
            onClick={() => setMenuOpen(false)}
            className="font-mono text-[14px] text-accent-text py-[11px] border-b border-line-2 hover:text-accent-d transition-colors"
          >
            $LOOP
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
          <div className="flex items-center justify-between py-[11px]">
            <span className="text-[15px] text-body">Chain</span>
            <ChainSwitch labels="always" className="flex" />
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

/** The connected-user avatar menu: profile, messages, and the labeled chain
 *  switch in one dropdown — replaces three separate 38px icon squares. */
function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const itemCls =
    "flex items-center gap-[10px] px-4 py-[10px] text-[13.5px] text-body hover:bg-surface-2 hover:text-ink transition-colors";

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Account"
        aria-label="Account menu"
        aria-haspopup="true"
        aria-expanded={open}
        className="flex items-center justify-center w-[38px] h-[38px] rounded-full bg-accent-tint border border-accent-tint-border text-accent-text hover:border-line-hover transition-colors"
      >
        <ProfileIcon size={17} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[220px] bg-surface border border-line-2 rounded-[14px] shadow-[0_14px_36px_-18px_rgba(22,19,26,0.35)] z-[60] py-1 overflow-hidden">
          <Link href="/profile" onClick={() => setOpen(false)} className={itemCls}>
            <ProfileIcon size={15} /> My profile
          </Link>
          <Link href="/messages" onClick={() => setOpen(false)} className={itemCls}>
            <MessageIcon size={15} /> Messages
          </Link>
          <div className="flex items-center justify-between px-4 py-[10px] border-t border-line-4">
            <span className="text-[12.5px] text-muted">Chain</span>
            <ChainSwitch labels="always" className="flex" />
          </div>
        </div>
      )}
    </div>
  );
}
