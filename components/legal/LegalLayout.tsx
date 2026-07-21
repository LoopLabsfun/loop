import Link from "next/link";
import { SiteHeader } from "../SiteHeader";

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
      <SiteHeader context={slug} />

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
            LEGAL
          </div>
          <h1 className="font-display font-bold text-[36px] leading-[1.1] tracking-[-0.03em] m-0 mb-3">
            {title}
          </h1>
          <p className="text-[16px] leading-[1.6] text-muted m-0 mb-4">{intro}</p>
          <div className="font-mono text-[12.5px] text-faint mb-10">
            Last updated: {lastUpdated}
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
