import Link from "next/link";
import { LoopMark } from "../LoopMark";

// Shared chrome + prose helpers for the legal pages (Terms / Privacy / Risk).
// Mirrors the Docs page styling. Content is honest where it can be; everything
// that needs the real legal entity / jurisdiction / counsel is marked with
// <ToComplete> so it's impossible to miss before going live.

export interface LegalSectionRef {
  id: string;
  label: string;
}

export function LegalLayout({
  slug,
  title,
  intro,
  lastUpdated = "—",
  sections,
  children,
}: {
  slug: string;
  title: string;
  intro: string;
  lastUpdated?: string;
  sections: LegalSectionRef[];
  children: React.ReactNode;
}) {
  return (
    <>
      <nav className="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 sm:px-10 py-[14px] bg-canvas/[0.88] backdrop-blur-md border-b border-line">
        <Link href="/" className="flex items-center gap-[10px] text-ink">
          <LoopMark width={34} height={20} />
          <span className="font-display font-bold text-[20px] tracking-[-0.02em]">
            Loop
          </span>
          <span className="text-line-hover">/</span>
          <span className="font-mono text-[13px] text-muted">{slug}</span>
        </Link>
        <div className="flex items-center gap-[10px]">
          <Link
            href="/docs"
            className="font-mono text-[13px] text-muted hover:text-ink transition-colors hidden sm:inline"
          >
            Docs
          </Link>
          <Link
            href="/"
            className="font-display font-semibold text-[14px] px-[18px] py-[9px] rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors whitespace-nowrap"
          >
            Launch a Project
          </Link>
        </div>
      </nav>

      <div className="max-w-[1100px] mx-auto px-6 sm:px-10 py-12 grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-12">
        {/* Sidebar TOC */}
        <aside className="hidden lg:block">
          <div className="sticky top-[90px]">
            <div className="font-mono text-[11px] uppercase tracking-wide text-faint mb-3">
              On this page
            </div>
            <nav className="flex flex-col gap-2">
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="text-[13.5px] text-muted hover:text-accent transition-colors"
                >
                  {s.label}
                </a>
              ))}
              <div className="border-t border-line-4 mt-3 pt-3 flex flex-col gap-2">
                <LegalNavLink href="/legal/terms" label="Terms of Service" active={slug === "terms"} />
                <LegalNavLink href="/legal/privacy" label="Privacy Policy" active={slug === "privacy"} />
                <LegalNavLink href="/legal/disclaimer" label="Risk & Disclaimer" active={slug === "disclaimer"} />
              </div>
            </nav>
          </div>
        </aside>

        {/* Content */}
        <article className="max-w-[720px]">
          <div className="inline-flex items-center gap-2 px-[14px] py-[6px] rounded-full bg-surface-2 border border-line-3 font-mono text-[12px] text-muted mb-6">
            LEGAL · DRAFT
          </div>
          <h1 className="font-display font-bold text-[36px] leading-[1.1] tracking-[-0.03em] m-0 mb-3">
            {title}
          </h1>
          <p className="text-[16px] leading-[1.6] text-muted m-0 mb-4">{intro}</p>
          <div className="font-mono text-[12.5px] text-faint mb-2">
            Last updated: {lastUpdated}
          </div>
          <div className="rounded-[12px] border border-warn bg-surface-2 px-4 py-3 text-[13px] text-body mb-10">
            <span className="font-medium text-ink">Draft — not yet legal advice.</span>{" "}
            This document is a working draft pending review by qualified counsel
            and the registration of the operating entity. Sections marked{" "}
            <ToComplete>like this</ToComplete> must be finalized before Loop opens
            to the public.
          </div>

          {children}

          <div className="mt-14 pt-6 border-t border-line-4 text-[13px] text-faint">
            Questions about these terms? Contact{" "}
            <ToComplete>legal@ — entity email</ToComplete>. See also{" "}
            <Link href="/docs" className="text-accent-text hover:text-accent-d transition-colors">
              the docs
            </Link>
            .
          </div>
        </article>
      </div>
    </>
  );
}

function LegalNavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`text-[13px] transition-colors ${
        active ? "text-accent font-medium" : "text-faint hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-[90px] mt-10 first:mt-0">
      <h2 className="font-display font-bold text-[22px] tracking-[-0.02em] m-0 mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function LP({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[15px] leading-[1.7] text-body m-0 mb-4">{children}</p>
  );
}

export function LStrong({ children }: { children: React.ReactNode }) {
  return <span className="text-ink font-medium">{children}</span>;
}

export function LList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc pl-5 my-2 flex flex-col gap-[7px]">
      {items.map((it, i) => (
        <li key={i} className="text-[15px] leading-[1.6] text-body">
          {it}
        </li>
      ))}
    </ul>
  );
}

/** A neutral inline blank for details to be filled in before a real launch.
 *  Renders as a subtle muted placeholder — nothing alarming, just a space. */
export function ToComplete({ children }: { children: React.ReactNode }) {
  return <span className="text-muted">{children}</span>;
}
