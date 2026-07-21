"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "./SiteHeader";
import { FollowButton } from "./FollowButton";
import { useWallet } from "@/lib/wallet";
import { agentRunState } from "@/lib/budget";
import { shortAddr } from "@/lib/format";
import type { Project } from "@/lib/types";
import type { SocialUser } from "@/lib/social";

type ProjectLite = { key: string; name: string; ticker: string; marketCap: string; official: boolean };

// Explore — a discovery surface (not a ranking): search across projects + people,
// or browse every live project and recently-joined people to follow.
export function ExploreView({ projects, people }: { projects: Project[]; people: SocialUser[] }) {
  const wallet = useWallet();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ projects: ProjectLite[]; people: SocialUser[] } | null>(null);
  const [searching, setSearching] = useState(false);

  // Debounced search — under 2 chars falls back to the browse view.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        setResults(await r.json());
      } catch {
        setResults({ projects: [], people: [] });
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const browseProjects: ProjectLite[] = projects.map((p) => ({ key: p.key, name: p.name, ticker: p.ticker, marketCap: p.marketCap, official: p.official }));
  const stateOf = new Map<string, ReturnType<typeof agentRunState>>(projects.map((p) => [p.key, agentRunState(p)]));
  const showProjects = results ? results.projects : browseProjects;
  const showPeople = results ? results.people : people;

  return (
    <div className="min-h-screen">
      <SiteHeader context="explore" />

      <main className="max-w-[1080px] mx-auto px-6 sm:px-8 py-7 flex flex-col gap-6">
        <div>
          <h1 className="font-display font-bold text-[24px] tracking-[-0.02em] m-0">Explore</h1>
          <p className="text-[13px] text-muted mt-1 mb-3">Search projects, people, and wallets — or browse what&apos;s on Loop.</p>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, @username, ticker, or wallet…"
            className="loop-input"
          />
        </div>

        {/* Projects */}
        {(showProjects.length > 0 || !results) && (
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-display font-semibold text-[16px] m-0">Projects</h2>
              <span className="font-mono text-[11px] text-faint">{showProjects.length}</span>
            </div>
            {showProjects.length === 0 ? (
              <Muted>{searching ? "Searching…" : "No matching projects."}</Muted>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {showProjects.map((p) => (
                  <ProjectCard key={p.key} p={p} state={stateOf.get(p.key)} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* People */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display font-semibold text-[16px] m-0">People</h2>
            <span className="font-mono text-[11px] text-faint">{showPeople.length}</span>
          </div>
          {showPeople.length === 0 ? (
            <Muted>{results ? (searching ? "Searching…" : "No matching people.") : "No profiles yet — be the first to set one up."}</Muted>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {showPeople.map((u) => (
                <PersonCard key={u.wallet} u={u} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] text-faint">{children}</div>;
}

function ProjectCard({ p, state }: { p: ProjectLite; state?: "pre-launch" | "asleep" | "active" }) {
  return (
    <Link href={`/token?p=${p.key}`} className="bg-surface border border-line-2 rounded-[16px] p-4 hover:border-line-hover transition-colors flex flex-col">
      <div className="flex items-center gap-[9px]">
        <span className="w-[34px] h-[34px] rounded-[10px] bg-accent-tint border border-accent-tint-border flex items-center justify-center font-display font-bold text-[13px] text-accent-text flex-none">
          {p.ticker.replace(/^\$/, "").slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-medium truncate">
            {p.name} {p.official && <span className="font-mono text-[9px] px-[5px] py-[1px] rounded-[5px] bg-accent text-white align-middle">OFFICIAL</span>}
          </div>
          <div className="font-mono text-[11px] text-accent-text">{p.ticker}</div>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-line-4 font-mono text-[11px]">
        <span className="text-muted">mcap {p.marketCap}</span>
        {state && <StateDot state={state} />}
      </div>
    </Link>
  );
}

function PersonCard({ u }: { u: SocialUser }) {
  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-4 flex items-center gap-[11px]">
      <Link href={`/u/${u.wallet}`} className="flex items-center gap-[11px] min-w-0 flex-1 group">
        {u.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={u.avatarUrl} alt="" className="w-[40px] h-[40px] rounded-[12px] object-cover border border-line-2 flex-none" />
        ) : (
          <span className="w-[40px] h-[40px] rounded-[12px] bg-accent-tint border border-accent-tint-border flex items-center justify-center font-display font-bold text-[16px] text-accent-text flex-none">
            {(u.displayName || u.wallet).slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium truncate group-hover:text-accent-text transition-colors">{u.displayName || shortAddr(u.wallet)}</div>
          <div className="font-mono text-[11px] text-faint truncate">{shortAddr(u.wallet)}</div>
        </div>
      </Link>
      <FollowButton target={u.wallet} following={u.youFollow} size="sm" />
    </div>
  );
}

function StateDot({ state }: { state: "pre-launch" | "asleep" | "active" }) {
  const map = {
    active: { c: "var(--pos)", t: "building" },
    asleep: { c: "var(--faint)", t: "asleep" },
    "pre-launch": { c: "var(--faint)", t: "pre-launch" },
  } as const;
  const s = map[state];
  return (
    <span className="inline-flex items-center gap-[5px]" style={{ color: s.c }}>
      <span className="w-[6px] h-[6px] rounded-full" style={{ background: s.c }} />
      {s.t}
    </span>
  );
}
