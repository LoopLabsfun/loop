"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SiteHeader } from "./SiteHeader";
import { useWallet } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";
import { useEnsureSession } from "@/lib/use-session";
import { apiDmConversations, apiDmThread, apiDmSend } from "@/lib/dm-client";
import type { Conversation, DmMessage } from "@/lib/dm";

function rel(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

export function MessagesView() {
  const wallet = useWallet();
  const params = useSearchParams();
  const initialPeer = params.get("to") || params.get("with");

  const [convos, setConvos] = useState<Conversation[]>([]);
  const [peer, setPeer] = useState<string | null>(initialPeer);
  const [thread, setThread] = useState<DmMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [needsSession, setNeedsSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Either wallet opens the same session (lib/use-session).
  const establish = useEnsureSession();
  const ensureSession = useCallback(async (): Promise<boolean> => {
    return (await establish()).ok;
  }, [establish]);

  const loadConvos = useCallback(async () => {
    try {
      const { conversations } = await apiDmConversations(wallet.address);
      setConvos(conversations);
      setNeedsSession(false);
    } catch (e) {
      if (e instanceof Error && e.message === "no-session") setNeedsSession(true);
    }
  }, [wallet.address]);

  const loadThread = useCallback(async (p: string) => {
    try {
      setThread(await apiDmThread(p, wallet.address));
    } catch (e) {
      if (e instanceof Error && e.message === "no-session") setNeedsSession(true);
    }
  }, [wallet.address]);

  // Initial load + polling while connected.
  useEffect(() => {
    if (!wallet.connected) return;
    loadConvos();
    const t = setInterval(() => {
      loadConvos();
      if (peer) loadThread(peer);
    }, 15_000);
    return () => clearInterval(t);
  }, [wallet.connected, peer, loadConvos, loadThread]);

  useEffect(() => {
    if (peer && wallet.connected) loadThread(peer);
  }, [peer, wallet.connected, loadThread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  async function startSession() {
    setBusy(true);
    try {
      if (await ensureSession()) {
        await loadConvos();
        if (peer) await loadThread(peer);
      }
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || !peer) return;
    setDraft("");
    // Optimistic append.
    setThread((t) => [
      ...t,
      { id: Date.now(), sender: wallet.address ?? "", recipient: peer, body: text, read: false, createdAt: new Date().toISOString(), mine: true },
    ]);
    try {
      await apiDmSend(peer, text, wallet.address);
    } catch (e) {
      if (e instanceof Error && e.message === "no-session" && (await ensureSession())) {
        await apiDmSend(peer, text, wallet.address);
      }
    }
    await Promise.all([loadThread(peer), loadConvos()]);
  }

  const peerConvo = convos.find((c) => c.peer === peer);
  const peerLabel = peerConvo?.peerName || (peer ? shortAddr(peer) : "");

  return (
    <div className="min-h-screen">
      <SiteHeader context="messages" />

      <main className="max-w-[1000px] mx-auto px-4 sm:px-8 py-6">
        <h1 className="font-display font-bold text-[24px] tracking-[-0.02em] m-0 mb-4">Messages</h1>

        {!wallet.connected ? (
          <Empty>
            <button onClick={wallet.connect} className="font-display font-semibold text-[14px] px-5 h-[40px] rounded-[10px] bg-accent text-white hover:opacity-90 transition-colors">
              Connect wallet
            </button>
          </Empty>
        ) : needsSession ? (
          <Empty>
            <p className="text-[13px] text-muted mb-4">Sign once to open your private messages.</p>
            <button onClick={startSession} disabled={busy} className="font-display font-semibold text-[14px] px-5 h-[40px] rounded-[10px] bg-accent text-white hover:opacity-90 disabled:opacity-60">
              {busy ? "Check your wallet…" : "Open messages"}
            </button>
          </Empty>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 h-[560px]">
            {/* Conversations */}
            <div className={`bg-surface border border-line-2 rounded-[16px] overflow-y-auto scroll-thin ${peer ? "hidden md:block" : ""}`}>
              {convos.length === 0 ? (
                <div className="text-[12.5px] text-faint p-4">No conversations yet. Open a profile and hit Message.</div>
              ) : (
                convos.map((c) => (
                  <button
                    key={c.peer}
                    onClick={() => setPeer(c.peer)}
                    className={`w-full text-left flex items-center gap-[10px] px-3 py-[11px] border-b border-line-4 hover:bg-surface-2 transition-colors ${peer === c.peer ? "bg-surface-2" : ""}`}
                  >
                    <PeerAvatar name={c.peerName || c.peer} url={c.peerAvatar} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate">{c.peerName || shortAddr(c.peer)}</div>
                      <div className="text-[11.5px] text-faint truncate">{c.lastMine ? "You: " : ""}{c.lastBody}</div>
                    </div>
                    {c.unread > 0 && <span className="min-w-[18px] h-[18px] px-[5px] rounded-full bg-accent text-white text-[10px] font-mono font-bold flex items-center justify-center flex-none">{c.unread}</span>}
                  </button>
                ))
              )}
            </div>

            {/* Thread */}
            <div className={`bg-surface border border-line-2 rounded-[16px] flex flex-col ${peer ? "" : "hidden md:flex"}`}>
              {!peer ? (
                <div className="flex-1 flex items-center justify-center text-[12.5px] text-faint">Select a conversation.</div>
              ) : (
                <>
                  <div className="px-4 h-[52px] flex items-center gap-[10px] border-b border-line-4 flex-none">
                    <button onClick={() => setPeer(null)} aria-label="Back to conversations" className="md:hidden text-muted text-[18px] leading-none">←</button>
                    <Link href={`/u/${peer}`} className="flex items-center gap-[9px] min-w-0 hover:opacity-80">
                      <PeerAvatar name={peerLabel} url={peerConvo?.peerAvatar ?? null} sm />
                      <span className="font-display font-semibold text-[14px] truncate">{peerLabel}</span>
                    </Link>
                  </div>
                  <div className="flex-1 overflow-y-auto scroll-thin px-4 py-3 flex flex-col gap-[8px]">
                    {thread.length === 0 ? (
                      <div className="text-[12.5px] text-faint text-center my-auto">No messages yet — say hi.</div>
                    ) : (
                      thread.map((m) => (
                        <div key={m.id} className={`max-w-[78%] px-[12px] py-[8px] rounded-[12px] text-[13px] leading-[1.4] ${m.mine ? "self-end bg-accent text-white" : "self-start bg-surface-2 text-ink"}`}>
                          {m.body}
                          <div className={`font-mono text-[9.5px] mt-[3px] ${m.mine ? "text-white/70" : "text-faint"}`}>{rel(m.createdAt)}</div>
                        </div>
                      ))
                    )}
                    <div ref={endRef} />
                  </div>
                  <div className="p-3 border-t border-line-4 flex gap-2 flex-none">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && send()}
                      maxLength={1000}
                      placeholder="Message…"
                      className="loop-input"
                    />
                    <button onClick={send} disabled={!draft.trim()} className="font-display font-semibold text-[13px] px-4 rounded-[10px] bg-accent text-white hover:opacity-90 disabled:opacity-50 flex-none">
                      Send
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-line-2 rounded-[16px] px-6 py-12 text-center flex flex-col items-center">
      {children}
    </div>
  );
}

function PeerAvatar({ name, url, sm }: { name: string; url: string | null; sm?: boolean }) {
  const s = sm ? "w-[28px] h-[28px] text-[12px]" : "w-[34px] h-[34px] text-[14px]";
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`${s} rounded-[10px] object-cover border border-line-2 flex-none`} />;
  }
  return (
    <span className={`${s} rounded-[10px] bg-accent-tint border border-accent-tint-border flex items-center justify-center font-display font-bold text-accent-text flex-none`}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
