"use client";

import Link from "next/link";
import { shortAddr } from "@/lib/format";
import type { ActivityItem, ActivityActor } from "@/lib/activity";

// The global activity feed — Loop's social pulse. Pure presentational: it takes a
// server-composed list and renders each kind with its own glyph + links, with
// client-side relative timestamps so they stay fresh.

function rel(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

function shipLabel(msg: string): string {
  return msg.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "");
}

function ActorLink({ a }: { a: ActivityActor }) {
  return (
    <Link href={`/u/${a.wallet}`} className="font-semibold hover:text-accent-text transition-colors">
      {a.name || shortAddr(a.wallet)}
    </Link>
  );
}

function Glyph({ kind }: { kind: ActivityItem["kind"] }) {
  const map = {
    ship: { ch: "↑", bg: "var(--accent-tint)", c: "var(--accent-text)" },
    launch: { ch: "✦", bg: "var(--accent-tint)", c: "var(--accent-text)" },
    follow: { ch: "+", bg: "var(--accent-tint)", c: "var(--accent-text)" },
    join: { ch: "◎", bg: "oklch(0.96 0.03 150)", c: "var(--pos)" },
  } as const;
  const m = map[kind];
  return (
    <span className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center font-display font-bold text-[14px] flex-none" style={{ background: m.bg, color: m.c }}>
      {m.ch}
    </span>
  );
}

function Avatar({ a }: { a: ActivityActor }) {
  if (a.avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={a.avatar} alt="" className="w-[30px] h-[30px] rounded-[9px] object-cover border border-line-2 flex-none" />;
  }
  return (
    <span className="w-[30px] h-[30px] rounded-[9px] bg-accent-tint border border-accent-tint-border flex items-center justify-center font-display font-bold text-[13px] text-accent-text flex-none">
      {(a.name || a.wallet).slice(0, 1).toUpperCase()}
    </span>
  );
}

function Row({ it }: { it: ActivityItem }) {
  let body: React.ReactNode;
  let glyph: React.ReactNode;
  switch (it.kind) {
    case "ship":
      glyph = <Glyph kind="ship" />;
      body = (
        <>
          <Link href={`/token?p=${it.projectKey}`} className="font-semibold hover:text-accent-text transition-colors">
            {it.ticker}
          </Link>{" "}
          <span className="text-muted">agent shipped</span> {shipLabel(it.text)}
        </>
      );
      break;
    case "launch":
      glyph = <Glyph kind="launch" />;
      body = (
        <>
          <Link href={`/token?p=${it.projectKey}`} className="font-semibold hover:text-accent-text transition-colors">
            {it.text}
          </Link>{" "}
          <span className="text-muted">launched on Loop</span>{" "}
          <span className="font-mono text-[11px] text-accent-text">{it.ticker}</span>
        </>
      );
      break;
    case "follow":
      glyph = it.actor ? <Avatar a={it.actor} /> : <Glyph kind="follow" />;
      body = (
        <>
          {it.actor && <ActorLink a={it.actor} />} <span className="text-muted">followed</span> {it.target && <ActorLink a={it.target} />}
        </>
      );
      break;
    case "join":
      glyph = it.actor ? <Avatar a={it.actor} /> : <Glyph kind="join" />;
      body = (
        <>
          {it.actor && <ActorLink a={it.actor} />} <span className="text-muted">joined Loop</span>
        </>
      );
      break;
  }
  return (
    <div className="flex items-start gap-[11px] py-[11px] border-b border-line-4 last:border-0">
      {glyph}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-[1.45]">{body}</div>
        <div className="font-mono text-[10.5px] text-faint mt-[2px]">{rel(it.at)}</div>
      </div>
    </div>
  );
}

export function ActivityFeed({ items, compact }: { items: ActivityItem[]; compact?: boolean }) {
  if (items.length === 0) {
    return <div className="text-[12.5px] text-faint py-3">No activity yet — be the first to launch, ship, or follow.</div>;
  }
  return <div>{(compact ? items.slice(0, 8) : items).map((it) => <Row key={it.id} it={it} />)}</div>;
}
