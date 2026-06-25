"use client";

import { useInspector } from "@/lib/inspector";
import { repoUrl, commitUrl } from "@/lib/format";
import { commitHashForTitle, type MatchCommit } from "@/lib/live-log";
import type { AgentTask } from "@/lib/agent";

// The shared "loop-engine" terminal — the dark Agent-activity panel with two
// columns: LATEST COMMITS (real repo commits, click a hash to verify on GitHub)
// and LIVE LOG (the agent's real task statuses). Used identically by the token
// page and the landing home so the two never drift — same component, same source.

type Commit = { hash: string; msg: string };

// Maps a persisted agent_tasks status to a glyph + verb + colour for the LIVE LOG.
const TASK_LOG: Record<string, { glyph: string; verb: string; cls: string }> = {
  shipped: { glyph: "✓", verb: "shipped", cls: "text-pos" },
  building: { glyph: "●", verb: "building", cls: "text-accent-400" },
  todo: { glyph: "○", verb: "queued", cls: "text-muted" },
  blocked: { glyph: "⚠", verb: "blocked", cls: "text-neg" },
};

export function AgentEngine({
  repo,
  label,
  commits,
  matchCommits,
  tasks = [],
  live = false,
  className = "",
  logCount = 8,
}: {
  /** Repo slug ("owner/name") for the header link + commit-verify links. */
  repo: string;
  /** Header label after "agent ", e.g. "$LOOP". */
  label: string;
  commits: Commit[];
  /**
   * Wider commit window used ONLY to link a shipped LIVE-LOG row to its commit
   * (title↔message match). Defaults to the displayed `commits`. A shipped task
   * with no match here is shown as "done" (no unverifiable "shipped" claim).
   */
  matchCommits?: MatchCommit[];
  tasks?: AgentTask[];
  /** Whether the agent has real activity (drives the LIVE LOG indicator). */
  live?: boolean;
  className?: string;
  /** How many LIVE-LOG rows to show (most recent first). */
  logCount?: number;
}) {
  // Quick at-a-glance counts across the recent task window, for the LIVE LOG
  // header — so you see "what the agent's been up to" without reading every row.
  const counts = tasks.reduce<Record<string, number>>((a, t) => {
    a[t.status] = (a[t.status] ?? 0) + 1;
    return a;
  }, {});
  const summary = [
    counts.shipped ? `${counts.shipped} shipped` : null,
    counts.building ? `${counts.building} building` : null,
    counts.todo ? `${counts.todo} queued` : null,
    counts.blocked ? `${counts.blocked} blocked` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={`bg-ink rounded-[16px] px-6 py-5 font-mono ${className}`}>
      <div className="flex items-center justify-between mb-[14px]">
        <div className="flex items-center gap-[10px]">
          <span
            className={`w-2 h-2 rounded-full ${live ? "bg-accent-400 animate-pulseFast" : "bg-muted"}`}
          />
          <span className="text-[12.5px] text-canvas">
            loop-engine · agent {label}
          </span>
        </div>
        {repoUrl(repo) ? (
          <a
            href={repoUrl(repo)!}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11.5px] text-muted hover:text-canvas transition-colors"
          >
            {repo} ↗
          </a>
        ) : (
          <span className="text-[11.5px] text-muted">{repo}</span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="flex flex-col gap-[7px]">
          <div className="text-[11px] text-muted mb-[2px]">
            LATEST COMMITS{" "}
            <span className="text-[#6B6675]">· tap a hash to verify on GitHub</span>
          </div>
          {commits.length === 0 ? (
            <div className="text-[12.5px] text-muted">No commits yet.</div>
          ) : (
            commits.map((c) => <CommitRow key={c.hash} commit={c} repo={repo} />)
          )}
        </div>
        <div className="flex flex-col gap-[7px]">
          <div className="text-[11px] text-muted mb-[2px] flex items-center justify-between">
            <span>LIVE LOG</span>
            {live ? (
              <span className="inline-flex items-center gap-[5px] text-[10.5px] text-pos">
                <span className="w-[6px] h-[6px] rounded-full bg-pos-bright animate-pulseFast" />
                live
              </span>
            ) : (
              <span className="text-[10.5px] text-[#6B6675]">
                idle · wakes when funded
              </span>
            )}
          </div>
          {summary && (
            <div className="text-[10.5px] text-[#6B6675] -mt-[2px] mb-[1px]">{summary}</div>
          )}
          {tasks.length ? (
            tasks
              .slice(0, logCount)
              .map((t) => (
                <LiveLogRow
                  key={t.id}
                  task={t}
                  repo={repo}
                  matchCommits={matchCommits ?? commits}
                />
              ))
          ) : (
            <div className="text-[12.5px] text-muted">
              Agent starts logging once it runs.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A LIVE LOG task line — clickable to open the agent-task detail drawer. A
// shipped row links to the commit that proves it (title↔message match); a
// shipped row with no matchable commit is shown as "done" (no unverifiable
// "shipped" claim — what the founder asked for).
const DONE_LOG = { glyph: "✓", verb: "done", cls: "text-muted" };
function LiveLogRow({
  task: t,
  repo,
  matchCommits,
}: {
  task: AgentTask;
  repo: string;
  matchCommits: MatchCommit[];
}) {
  const { inspect } = useInspector();
  const matchedHash =
    t.status === "shipped" ? commitHashForTitle(t.title, matchCommits) : null;
  const url = matchedHash ? commitUrl(repo, matchedHash) : null;
  const L =
    t.status === "shipped" && !matchedHash
      ? DONE_LOG
      : TASK_LOG[t.status] ?? TASK_LOG.todo;
  return (
    <div className="text-[12.5px] flex items-baseline gap-2 w-full animate-fadeInFast">
      <button
        onClick={() => inspect({ kind: "task", task: t })}
        className="flex items-baseline gap-2 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
      >
        <span className={L.cls}>{L.glyph}</span>
        <span className="text-[#B7B2BE] truncate">
          <span className={L.cls}>{L.verb}</span> {t.title}
        </span>
      </button>
      <span className="ml-auto flex items-baseline gap-2 whitespace-nowrap font-mono text-[10.5px]">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="View this commit on GitHub"
            className="text-accent-400 hover:underline"
          >
            {matchedHash} ↗
          </a>
        )}
        <span className="text-[#6B6675]">{t.at}</span>
      </span>
    </div>
  );
}

// A commit line — the row opens the commit detail drawer; the hash still links
// out to GitHub (stopPropagation so it doesn't also open the drawer).
function CommitRow({
  commit: c,
  repo,
}: {
  commit: { hash: string; msg: string };
  repo: string;
}) {
  const { inspect } = useInspector();
  const url = commitUrl(repo, c.hash);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inspect({ kind: "commit", commit: c })}
      onKeyDown={(e) => {
        if (e.key === "Enter") inspect({ kind: "commit", commit: c });
      }}
      className="text-[12.5px] text-[#B7B2BE] cursor-pointer hover:opacity-80 transition-opacity"
    >
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-accent-400 hover:underline"
          title="View this commit on GitHub"
        >
          {c.hash}
        </a>
      ) : (
        <span className="text-accent-400">{c.hash}</span>
      )}{" "}
      {c.msg}
    </div>
  );
}
