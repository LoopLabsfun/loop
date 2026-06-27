"use client";

import Link from "next/link";
import { LoopMark } from "./LoopMark";
import { NavUserActions } from "./NavUserActions";
import { FollowButton } from "./FollowButton";
import { useWallet } from "@/lib/wallet";
import { agentRunState } from "@/lib/budget";
import { shortAddr } from "@/lib/format";
import type { Project } from "@/lib/types";
import type { SocialUser } from "@/lib/social";

// Explore — a discovery surface (not a ranking): every live project, plus people
// to follow. Projects link to their token page; people get an inline Follow.
export function ExploreView({ projects, people }: { projects: Project[]; people: SocialUser[] }) {
  const wallet = useWallet();
  return (
    <div className="min-h-screen">
      <nav className="border-b border-line max-w-[1280px] mx-auto px-6 sm:px-8 h-[60px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-[10px]">
          <LoopMark width={24} height={15} stroke="var(--accent)" />
          <span className="font-display font-bold text-[16px] tracking-[-0.02em]">Loop</span>
        </Link>
        <div className="flex items-center gap-[8px]">
          <NavUserActions messagesHidden />
          <button onClick={wallet.toggle} className="font-mono text-[12px] px-3 py-[7px] rounded-[10px] border border-line-3 hover:border-line-hover transition-colors">
            {wallet.label}
          </button>
        </div>
      </nav>

      <main className="max-w-[1080px] mx-auto px-6 sm:px-8 py-7 flex flex-col gap-8">
        <div>
          <h1 className="font-display font-bold text-[24px] tracking-[-0.02em] m-0">Explore</h1>
          <p className="text-[13px] text-muted mt-1 mb-0">Browse every project and the people building on Loop.</p>
        </div>

        {/* Projects */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display font-semibold text-[16px] m-0">Projects</h2>
            <span className="font-mono text-[11px] text-faint">{projects.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((p) => {
              const state = agentRunState(p);
              return (
                <Link
                  key={p.key}
                  href={`/token?p=${p.key}`}
                  className="bg-surface border border-line-2 rounded-[16px] p-4 hover:border-line-hover transition-colors flex flex-col"
                >
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
                  <p className="text-[12px] text-muted leading-[1.5] mt-[10px] mb-0 line-clamp-2">{p.description}</p>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-line-4 font-mono text-[11px]">
                    <span className="text-muted">mcap {p.marketCap}</span>
                    <StateDot state={state} />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* People */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display font-semibold text-[16px] m-0">People</h2>
            <span className="font-mono text-[11px] text-faint">{people.length}</span>
          </div>
          {people.length === 0 ? (
            <div className="text-[12.5px] text-faint">No profiles yet — be the first to set one up.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {people.map((u) => (
                <div key={u.wallet} className="bg-surface border border-line-2 rounded-[16px] p-4 flex items-center gap-[11px]">
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
              ))}
            </div>
          )}
        </section>
      </main>
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
