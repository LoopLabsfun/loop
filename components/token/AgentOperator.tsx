"use client";

import { useState } from "react";
import {
  agentEmail,
  agentSite,
  agentTwitter,
  CATEGORY_LABEL,
  STATUS_LABEL,
  type AgentTask,
  type InboxMessage,
  type SocialPost,
  type DailySummary,
  type TaskStatus,
} from "@/lib/agent";
import { telegramBotHandle, telegramBotUrl } from "@/lib/telegram";
import type { Project } from "@/lib/types";

type Tab = "tasks" | "inbox" | "social" | "summary";
const TABS: { id: Tab; label: string }[] = [
  { id: "tasks", label: "Tasks" },
  { id: "summary", label: "Summary" },
  { id: "inbox", label: "Inbox" },
  { id: "social", label: "Social" },
];

const STATUS_STYLE: Record<TaskStatus, string> = {
  shipped: "text-pos bg-surface-2 border-pos",
  building: "text-accent-text bg-accent-tint border-accent-tint-border",
  todo: "text-muted bg-surface-2 border-line-4",
  blocked: "text-neg bg-surface-2 border-neg",
};

const EMPTY: Record<Tab, string> = {
  tasks: "No tasks yet — the agent queues work once it runs.",
  inbox: "Inbox empty — no agent emails yet.",
  social: "No posts yet — the agent shares build updates here.",
  summary: "No daily summaries yet.",
};

export function AgentOperator({
  project: p,
  tasks: tasksProp,
  inbox: inboxProp,
  social: socialProp,
  summaries: summariesProp,
}: {
  project: Project;
  tasks?: AgentTask[];
  inbox?: InboxMessage[];
  social?: SocialPost[];
  summaries?: DailySummary[];
}) {
  const [tab, setTab] = useState<Tab>("tasks");
  // Real rows from the runtime, or honestly empty — no simulated seeds. Agent
  // identity (email/site/socials) is real (derived from the project slug);
  // visitor/signup/revenue metrics are 0 until real analytics are wired.
  const tasks = tasksProp ?? [];
  const inbox = inboxProp ?? [];
  const social = socialProp ?? [];
  const summaries = summariesProp ?? [];
  const stats = {
    email: agentEmail(p),
    site: agentSite(p),
    twitter: agentTwitter(p),
    visitors: 0,
    signups: 0,
    revenueUsd: 0,
  };
  const sent = inbox.filter((m) => m.direction === "out").length;
  const received = inbox.length - sent;

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] overflow-hidden">
      {/* Header — agent identity */}
      <div className="px-5 py-[14px] border-b border-line-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-[7px] h-[7px] rounded-full bg-pos-bright animate-pulseFast" />
            <span className="font-display font-semibold text-[15px]">
              Autonomous work
            </span>
          </div>
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap font-mono text-[11.5px] text-muted">
            <span className="text-accent-text">{stats.email}</span>
            <span className="text-faint">·</span>
            <span>{stats.twitter}</span>
            <span className="text-faint">·</span>
            <a
              href={telegramBotUrl(p)}
              target="_blank"
              rel="noopener noreferrer"
              title="Follow this project's read-only build-update bot on Telegram"
              className="hover:text-accent-text transition-colors"
            >
              {telegramBotHandle(p)}
            </a>
            <span className="text-faint">·</span>
            <span>{stats.site}</span>
          </div>
        </div>
        {/* Business stats row */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Visitors" value={stats.visitors.toLocaleString()} />
          <Stat label="Signups" value={String(stats.signups)} />
          <Stat
            label="Revenue"
            value={stats.revenueUsd ? `$${stats.revenueUsd}` : "$0"}
          />
          <Stat label="Email" value={`${sent} sent · ${received} in`} />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-5 pt-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`font-mono text-[12px] px-3 py-[6px] rounded-[8px] transition-colors ${
              tab === t.id
                ? "bg-ink text-white"
                : "text-muted hover:text-ink hover:bg-surface-2"
            }`}
          >
            {t.label}
            <span className="ml-[6px] text-faint">
              {t.id === "tasks"
                ? tasks.length
                : t.id === "inbox"
                  ? inbox.length
                  : t.id === "social"
                    ? social.length
                    : summaries.length}
            </span>
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="px-5 py-3 flex flex-col gap-[10px] max-h-[340px] overflow-y-auto scroll-thin">
        {(tab === "tasks"
          ? tasks.length
          : tab === "inbox"
            ? inbox.length
            : tab === "social"
              ? social.length
              : summaries.length) === 0 && (
          <div className="text-[12.5px] text-faint text-center py-6">
            {EMPTY[tab]}
          </div>
        )}

        {tab === "tasks" &&
          tasks.map((t) => (
            <div
              key={t.id}
              className="rounded-[10px] border border-line-3 bg-surface px-3 py-[10px]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-display font-semibold text-[13.5px] text-ink truncate">
                  {t.title}
                </span>
                <span
                  className={`font-mono text-[10px] px-[7px] py-[2px] rounded-[6px] border whitespace-nowrap ${STATUS_STYLE[t.status]}`}
                >
                  {STATUS_LABEL[t.status]}
                </span>
              </div>
              <div className="text-[12px] text-muted mt-[3px]">{t.detail}</div>
              <div className="flex items-center gap-2 mt-2">
                <span className="font-mono text-[10px] text-muted bg-surface-2 border border-line-4 rounded-[5px] px-[6px] py-[1px]">
                  {CATEGORY_LABEL[t.category]}
                </span>
                <span className="font-mono text-[10.5px] text-faint">{t.at}</span>
              </div>
            </div>
          ))}

        {tab === "inbox" &&
          inbox.map((m) => (
            <div
              key={m.id}
              className="flex gap-3 rounded-[10px] border border-line-3 bg-surface px-3 py-[10px]"
            >
              <span
                className={`font-mono text-[13px] mt-[1px] ${m.direction === "out" ? "text-accent" : "text-pos"}`}
                title={m.direction === "out" ? "sent" : "received"}
              >
                {m.direction === "out" ? "↗" : "↘"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-semibold text-[13px] text-ink truncate">
                    {m.subject}
                  </span>
                  <span className="font-mono text-[10.5px] text-faint whitespace-nowrap">
                    {m.at}
                  </span>
                </div>
                <div className="text-[12px] text-muted truncate">
                  {m.direction === "out" ? "To" : "From"}{" "}
                  <span className="text-body">{m.party}</span> — {m.preview}
                </div>
              </div>
            </div>
          ))}

        {tab === "social" &&
          social.map((s) => (
            <div
              key={s.id}
              className="rounded-[10px] border border-line-3 bg-surface px-3 py-[10px]"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] text-accent-text uppercase tracking-wide">
                  {s.platform}
                </span>
                <span className="font-mono text-[10.5px] text-faint">{s.at}</span>
              </div>
              <div className="text-[13px] text-ink mt-[3px]">{s.text}</div>
              <div className="flex items-center gap-3 mt-2 font-mono text-[11px] text-muted">
                <span>♥ {s.likes}</span>
                <span>↩ {s.replies}</span>
              </div>
            </div>
          ))}

        {tab === "summary" &&
          summaries.map((s) => (
            <div
              key={s.id}
              className="rounded-[10px] border border-line-3 bg-surface px-3 py-[10px]"
            >
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold text-[13px] text-ink">
                  {s.day}
                </span>
                <span className="font-mono text-[10.5px] text-faint">
                  {s.shipped.length ? `${s.shipped.length} shipped` : "no ships"}
                </span>
              </div>
              {s.shipped.length > 0 ? (
                <ul className="mt-[5px] flex flex-col gap-[3px]">
                  {s.shipped.map((line, i) => (
                    <li
                      key={i}
                      className="text-[12.5px] text-body flex gap-[6px]"
                    >
                      <span className="text-pos">✓</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[12.5px] text-muted mt-[5px]">
                  Nothing shipped.
                </div>
              )}
              {s.note && (
                <div className="text-[12px] text-faint mt-[6px] italic">
                  {s.note}
                </div>
              )}
            </div>
          ))}
      </div>

      {/* Footer note */}
      <div className="px-5 py-[11px] border-t border-line-4 text-[11px] text-faint">
        {tab === "tasks"
          ? "The agent works this queue autonomously within its mandate; blocked items escalate to the founder."
          : tab === "summary"
            ? "Honest per-cycle log — what shipped and what didn't. \"No ships\" is a valid day."
            : tab === "inbox"
              ? `Replies to ${stats.email} route into the Agent Console for the founder to handle.`
              : "Posts are drafted by the agent; outreach beyond the mandate is escalated before publishing."}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[9px] border border-line-4 bg-surface-2 px-3 py-2">
      <div className="font-mono text-[10px] text-faint uppercase tracking-wide">
        {label}
      </div>
      <div className="font-display font-semibold text-[14px] text-ink mt-[1px] truncate">
        {value}
      </div>
    </div>
  );
}
