import type { Metadata } from "next";
import Link from "next/link";
import { LoopMark } from "@/components/LoopMark";
import { getProject } from "@/lib/queries";
import { getAgentState } from "@/lib/agent-data";
import { getRecentCommits } from "@/lib/commits";

// The public build journal: everything the LOOP agent ships, in the open. This is
// the build-in-public proof surface — daily shipped-task rollups, the agent's
// social posts, and the live commit feed, all from the real agent_* tables + repo.
// force-dynamic so a fresh tick appears without a redeploy.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Build Log — Loop",
  description:
    "Everything the LOOP agent ships, in public — daily rollups, posts, and commits.",
};

export default async function LogPage() {
  const project = await getProject("loop");
  const [state, commits] = await Promise.all([
    project ? getAgentState(project) : Promise.resolve(null),
    project ? getRecentCommits(project.repo, 20) : Promise.resolve([]),
  ]);
  const summaries = state?.summaries ?? [];
  const posts = state?.social ?? [];

  return (
    <>
      <nav className="sticky top-0 z-50 flex items-center justify-between gap-2 px-4 sm:px-8 py-[14px] bg-canvas/[0.88] backdrop-blur-md border-b border-line">
        <Link href="/" className="flex items-center gap-[10px] text-ink">
          <LoopMark width={30} height={18} />
          <span className="font-display font-bold text-[19px] tracking-[-0.02em]">Loop</span>
          <span className="text-line-hover">/</span>
          <span className="font-mono text-[13px] text-accent-text">build log</span>
        </Link>
        <Link
          href="/token?p=loop"
          className="text-[13.5px] text-muted hover:text-ink transition-colors px-[14px] py-[9px]"
        >
          $LOOP →
        </Link>
      </nav>

      <main className="max-w-[760px] mx-auto px-6 sm:px-8 py-10">
        <header className="mb-9">
          <h1 className="font-display font-bold text-[30px] tracking-[-0.02em] m-0">
            Build Log
          </h1>
          <p className="text-[14px] text-muted mt-2 mb-0 leading-[1.55]">
            Everything the LOOP agent ships, in public — pulled live from the real
            task queue, the agent&apos;s posts, and the repo. No edits, no spin.
          </p>
        </header>

        {/* Daily shipped rollups — the honest "what landed" record. */}
        <Section title="Shipped, by day">
          {summaries.length === 0 ? (
            <Empty>No shipped days recorded yet — they appear as the agent works.</Empty>
          ) : (
            <div className="flex flex-col gap-5">
              {summaries.map((s) => (
                <div key={s.id} className="border-l-2 border-line-3 pl-4">
                  <div className="font-display font-semibold text-[14px] text-ink mb-[6px]">
                    {s.day}
                  </div>
                  {s.shipped.length > 0 ? (
                    <ul className="m-0 p-0 list-none flex flex-col gap-[6px]">
                      {s.shipped.map((t, i) => (
                        <li key={i} className="flex gap-[8px] text-[13px] text-body">
                          <span className="text-pos flex-none mt-[1px]">✓</span>
                          <span className="leading-[1.45]">{t}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-[12.5px] text-faint">
                      {s.note || "No ships this day."}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* The agent's own voice — build-in-public posts. */}
        <Section title="Agent posts">
          {posts.length === 0 ? (
            <Empty>No posts yet.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {posts.slice(0, 12).map((p) => (
                <div
                  key={p.id}
                  className="bg-surface border border-line-2 rounded-[12px] px-4 py-3"
                >
                  <div className="flex items-center justify-between mb-[6px]">
                    <span className="font-mono text-[11px] text-accent-text uppercase">
                      {p.platform}
                    </span>
                    <span className="font-mono text-[11px] text-faint">{p.at}</span>
                  </div>
                  <p className="text-[13.5px] text-body leading-[1.5] m-0">{p.text}</p>
                  {(p.likes > 0 || p.replies > 0) && (
                    <div className="flex gap-3 mt-2 font-mono text-[11px] text-faint">
                      <span>♥ {p.likes}</span>
                      <span>↩ {p.replies}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* The verifiable layer — real commits on the repo. */}
        <Section title="Commits">
          {commits.length === 0 ? (
            <Empty>No commits to show.</Empty>
          ) : (
            <div className="flex flex-col gap-[7px]">
              {commits.map((c) => (
                <a
                  key={c.hash}
                  href={`https://github.com/${repoSlug(project?.repo)}/commit/${c.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 font-mono text-[12.5px] hover:opacity-80 transition-opacity"
                >
                  <span className="text-accent-text flex-none">{c.hash.slice(0, 7)}</span>
                  <span className="text-muted truncate">{c.msg}</span>
                </a>
              ))}
            </div>
          )}
        </Section>
      </main>

      <footer className="border-t border-line py-[22px] px-8 max-w-[760px] mx-auto">
        <span className="text-[12.5px] text-faint">
          © 2026 Loop · the platform that builds itself
        </span>
      </footer>
    </>
  );
}

function repoSlug(repo: string | undefined): string {
  return (repo ?? "LoopLabsfun/loop")
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="font-display font-semibold text-[16px] tracking-[-0.01em] mb-4 pb-2 border-b border-line-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] text-faint py-2">{children}</div>;
}
