"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellIcon } from "./AuthIcons";
import { useWallet } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";
import { apiLoadNotifications, apiMarkNotificationsRead } from "@/lib/social-client";
import { useEnsureSession } from "@/lib/use-session";
import type { Notification } from "@/lib/social";

// The notification bell: a wallet-gated dropdown over the PRIVATE notification
// feed. It polls /api/notifications using the user session cookie (no wallet
// popup); if no session exists yet, the FIRST open asks for one signature to open
// a 7-day session, then it just works. Opening the panel marks everything read.
// Hidden entirely when no wallet is connected.

function rel(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

export function NotificationBell() {
  const wallet = useWallet();
  const establish = useEnsureSession();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [needsSession, setNeedsSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const { items, unread } = await apiLoadNotifications(wallet.address);
      setItems(items);
      setUnread(unread);
      setNeedsSession(false);
    } catch (e) {
      if (e instanceof Error && e.message === "no-session") setNeedsSession(true);
    }
  }, [wallet.address]);

  // Poll for the unread badge while connected (cheap; cookie-authed, no popup).
  useEffect(() => {
    if (!wallet.connected) {
      setItems([]);
      setUnread(0);
      setNeedsSession(false);
      return;
    }
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [wallet.connected, load]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function onToggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    if (needsSession) {
      // First open without a session — one signature (from EITHER wallet)
      // opens a 7-day session.
      setBusy(true);
      try {
        if ((await establish()).ok) await load();
      } finally {
        setBusy(false);
      }
      return;
    }
    // Has a session — refresh, then mark everything read.
    await load();
    if (unread > 0) {
      setUnread(0);
      apiMarkNotificationsRead().catch(() => {});
    }
  }

  if (!wallet.connected) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={onToggle}
        title="Notifications"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative flex items-center justify-center w-[38px] h-[38px] rounded-[10px] border border-line-3 bg-surface text-muted hover:text-accent-text hover:border-line-hover transition-colors"
      >
        <BellIcon size={17} />
        {unread > 0 && (
          <span className="absolute -top-[3px] -right-[3px] min-w-[16px] h-[16px] px-[4px] rounded-full bg-accent text-white text-[10px] font-mono font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[300px] max-h-[420px] overflow-y-auto scroll-thin bg-surface border border-line-2 rounded-[14px] shadow-[0_14px_36px_-18px_rgba(22,19,26,0.35)] z-[60]">
          <div className="px-4 py-3 border-b border-line-4 flex items-center justify-between sticky top-0 bg-surface">
            <span className="font-display font-semibold text-[14px]">Notifications</span>
            {busy && <span className="font-mono text-[11px] text-faint">…</span>}
          </div>
          {needsSession ? (
            <div className="px-4 py-6 text-center text-[12.5px] text-muted">
              {busy ? "Check your wallet…" : "Sign once to open your notifications."}
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12.5px] text-faint">No notifications yet.</div>
          ) : (
            items.map((n) => <NotificationRow key={n.id} n={n} />)
          )}
        </div>
      )}
    </div>
  );
}

function NotificationRow({ n }: { n: Notification }) {
  const isEsc = n.type === "escalation";
  const isDm = n.type === "dm";
  const name = isEsc
    ? `$${String(n.data.projectKey ?? "").toUpperCase()} needs you`
    : n.actorName || (n.actor ? shortAddr(n.actor) : "Someone");
  const text = isEsc
    ? (n.data.text as string) || "an escalation is awaiting your sign-off"
    : isDm
      ? (n.data.text as string) || "sent you a message"
      : "started following you";
  const inner = (
    <div className="flex items-start gap-[10px] px-4 py-[11px] border-b border-line-4 last:border-0 hover:bg-surface-2 transition-colors">
      {isEsc ? (
        <span className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center font-display font-bold text-[15px] flex-none" style={{ background: "oklch(0.96 0.03 25)", color: "var(--neg)" }}>
          !
        </span>
      ) : n.actorAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={n.actorAvatar} alt="" className="w-[30px] h-[30px] rounded-[9px] object-cover border border-line-2 flex-none" />
      ) : (
        <span className="w-[30px] h-[30px] rounded-[9px] bg-accent-tint border border-accent-tint-border flex items-center justify-center font-display font-bold text-[13px] text-accent-text flex-none">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] leading-[1.4]">
          <span className="font-semibold">{name}</span>{" "}
          <span className="text-muted">{isEsc || isDm ? (isDm ? "sent you a message" : "") : text}</span>
          {(isEsc || isDm) && <span className="text-muted block mt-[1px] truncate">{isDm ? `“${text}”` : text}</span>}
        </div>
        <div className="font-mono text-[10px] text-faint mt-[2px]">{rel(n.createdAt)}</div>
      </div>
      {!n.read && <span className="w-[7px] h-[7px] rounded-full bg-accent flex-none mt-[6px]" />}
    </div>
  );
  const href = isEsc ? "/admin" : isDm && n.actor ? `/messages?with=${n.actor}` : n.actor ? `/u/${n.actor}` : null;
  return href ? <Link href={href}>{inner}</Link> : inner;
}
