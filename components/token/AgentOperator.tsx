"use client";

import { useState } from "react";
import {
  agentEmail,
  CATEGORY_LABEL,
  STATUS_LABEL,
  type AgentTask,
  type InboxMessage,
  type SocialPost,
  type DailySummary,
  type TaskStatus,
} from "@/lib/agent";
import { useInspector } from "@/lib/inspector";
import type { Project } from "@/lib/types";

// Real social identities only when actually configured (platform-level for now,
// Phase A / LOOP). Otherwise the UI shows an honest "soon" — never a fake handle
// or a t.me link that 404s. These auto-go-live the moment the founder sets them.
const X_HANDLE = process.env.NEXT_PUBLIC_X_HANDLE || "";
const TELEGRAM_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "";
const SITE_URL = process.env.NEXT_PUBLIC_AGENT_SITE_URL || "";

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
  metrics,
}: {
  project: Project;
  tasks?: AgentTask[];
  inbox?: InboxMessage[];
  social?: SocialPost[];
  summaries?: DailySummary[];
  /**
   * Real business metrics, server-fetched. `visitors` = total Vercel Web
   * Analytics visitors since launch; `holders` = live on-chain holder count
   * (already a formatted string). `sessions` / `ticks` = optional DB-level
   * overrides; if omitted they fall back to summaries.length / tasks.length.
   * Any null/undefined ⇒ honest "—".
   */
  metrics?: {
    visitors?: number | null;
    holders?: string | null;
    sessions?: number | null;
    ticks?: number | null;
  };
}) {
  const [tab, setTab] = useState<Tab>("tasks");
  const { inspect } = useInspector();
  // Real rows from the runtime, or honestly empty — no simulated seeds. The
  // email is real (Resend-verified); X/Telegram/site show "soon" unless really
  // configured (see identity row). Visitor/signup metrics are 0 until real
  // analytics are wired.
  const tasks = tasksProp ?? [];
  const inbox = inboxProp ?? [];
  const social = socialProp ?? [];
  const summaries = summariesProp ?? [];
  const stats = { email: agentEmail(p) };
  const sent = inbox.filter((m) => m.direction === "out").length;
  const received = inbox.length - sent;
  // Real traction: how many DISTINCT things the agent has actually shipped
  // (deduped by title, so a re-proposed same-title task never inflates the count).
  const shipped = new Set(
    tasks.filter((t) => t.status === "shipped").map((t) => t.title)
  ).size;
  const visitors =
    metrics?.visitors != null
      ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
          Math.max(0, metrics.visitors)
        )
      : "—";
  const holders = metrics?.holders && metrics.holders.length ? metrics.holders : "—";
  // Sessions = distinct active days (one DailySummary per day), with optional
  // DB-level override from callers that have a real session count.
  const sessions = metrics?.sessions != null ? metrics.sessions : summaries.length;
  // Ticks = total task-queue entries seen, with optional DB-level override.
  const ticks = metrics?.ticks != null ? metrics.ticks : tasks.length;

  // Social links: prefer the project's own (admin-set) links, else fall back to the
  // configured global handles. Stored values are canonical https URLs.
  const tail = (u: string) => u.replace(/\/+$/, "").split("/").pop() || u;
  const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const xUrl = p.twitter ?? (X_HANDLE ? `https://x.com/${X_HANDLE}` : null);
  const tgUrl = p.telegram ?? (TELEGRAM_USERNAME ? `https://t.me/${TELEGRAM_USERNAME}` : null);
  const discordUrl = p.discord ?? null;
  const siteUrl = p.website ?? SITE_URL ?? null;

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
            {/* Email — real (Resend-verified, live). */}
            <a
              href={`mailto:${stats.email}`}
              className="text-accent-text hover:text-accent-d transition-colors"
            >
              {stats.email}
            </a>
            {/* X — per-project handle, else the configured global, else "soon". */}
            <span className="text-faint">·</span>
            {xUrl ? (
              <a
                href={xUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent-text transition-colors"
              >
                @{tail(xUrl)}
              </a>
            ) : (
              <span className="text-faint">X soon</span>
            )}
            {/* Telegram — per-project link, else the configured global, else "soon". */}
            <span className="text-faint">·</span>
            {tgUrl ? (
              <a
                href={tgUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="Join the project's Telegram"
                className="hover:text-accent-text transition-colors"
              >
                @{tail(tgUrl)}
              </a>
            ) : (
              <span className="text-faint">Telegram soon</span>
            )}
            {/* Discord — only when the project has an invite set. */}
            {discordUrl && (
              <>
                <span className="text-faint">·</span>
                <a
                  href={discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent-text transition-colors"
                >
                  Discord
                </a>
              </>
            )}
            {/* Site — per-project website, else a configured global site. */}
            {siteUrl && (
              <>
                <span className="text-faint">·</span>
                <a
                  href={siteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-accent-text transition-colors"
                >
                  {host(siteUrl)}
                </a>
              </>
            )}
          </div>
        </div>
        {/* Traction stats — no fiat "revenue" line: value is on-chain (token +
            buyback/airdrop/bounty to holders), surfaced in Project Wallet. */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {/* Real metrics where we have a source, honest "—" otherwise.
              Shipped = distinct things the agent has built; Visitors = total Vercel
              Web Analytics visitors since launch; Holders = live on-chain count of
              wallets holding the token; Email = real sent/received from the mailbox;
              Sessions = distinct active days from summaries; Ticks = total task-queue
              entries seen. */}
          <Stat
            label="Shipped"
            value={shipped ? String(shipped) : "—"}
            title="Distinct features/fixes the agent has shipped (deduped by title)"
          />
          <Stat
            label="Visitors"
            value={visitors}
            title="Total Vercel Web Analytics visitors since launch"
          />
          <Stat
            label="Holders"
            value={holders}
            title="Live on-chain count of wallets holding the token"
          />
          <Stat
            label="Email"
            value={sent || received ? `${sent} sent · ${received} in` : "—"}
            title={
              sent || received
                ? "Agent mailbox: emails sent + received"
                : "No emails yet — inbound routing (EMAIL_INBOUND_SECRET) and autonomous send (AGENT_EMAIL_SEND) are off, so the mailbox is empty until wired"
            }
          />
          <Stat
            label="Sessions"
            value={sessions ? String(sessions) : "—"}
            title="Distinct active days the agent has run (one per daily summary)"
          />
          <Stat
            label="Ticks"
            value={ticks ? String(ticks) : "—"}
            title="Total task-queue entries the agent has processed"
          />
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
              role="button"
              tabIndex={0}
              onClick={() => inspect({ kind: "task", task: t })}
              onKeyDown={(e) => {
                if (e.key === "Enter") inspect({ kind: "task", task: t });
              }}
              className="rounded-[10px] border border-line-3 bg-surface px-3 py-[10px] cursor-pointer hover:border-line-hover transition-colors"
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
              role="button"
              tabIndex={0}
              onClick={() => inspect({ kind: "email", email: m })}
              onKeyDown={(e) => {
                if (e.key === "Enter") inspect({ kind: "email", email: m });
              }}
              className="flex gap-3 rounded-[10px] border border-line-3 bg-surface px-3 py-[10px] cursor-pointer hover:border-line-hover transition-colors"
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
              role="button"
              tabIndex={0}
              onClick={() => inspect({ kind: "social", post: s })}
              onKeyDown={(e) => {
                if (e.key === "Enter") inspect({ kind: "social", post: s });
              }}
              className="rounded-[10px] border border-line-3 bg-surface px-3 py-[10px] cursor-pointer hover:border-line-hover transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10.5px] text-accent-text uppercase tracking-wide">
                  {s.platform}
                </span>
                <span className="font-mono text-[10.5px] text-faint">{s.at}</span>
              </div>
              <div className="text-[13px] text-ink mt-[3px]">{s.text}</div>
              {/* Engagement only when we actually have it — no fake "♥ 0 ↩ 0"
                  (platform metrics aren't fetched back yet). */}
              {(s.likes > 0 || s.replies > 0) && (
                <div className="flex items-center gap-3 mt-2 font-mono text-[11px] text-muted">
                  <span>♥ {s.likes}</span>
                  <span>↩ {s.replies}</span>
                </div>
              )}
            </div>
          ))}

        {tab === "summary" &&
          summaries.map((s) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() =>
                inspect({
                  kind: "summary",
                  summary: { text: s.note, at: s.day, shipped: s.shipped },
                })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  inspect({
                    kind: "summary",
                    summary: { text: s.note, at: s.day, shipped: s.shipped },
                  });
              }}
              className="rounded-[10px] border border-line-3 bg-surface px-3 py-[10px] cursor-pointer hover:border-line-2 transition-colors"
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

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title} className="rounded-[9px] border border-line-4 bg-surface-2 px-3 py-2">
      <div className="font-mono text-[10px] text-faint uppercase tracking-wide">
        {label}
      </div>
      <div className="font-display font-semibold text-[14px] text-ink mt-[1px] truncate">
        {value}
      </div>
    </div>
  );
}
