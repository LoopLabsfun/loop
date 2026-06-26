"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoopMark } from "../LoopMark";
import { useWallet } from "@/lib/wallet";
import { agentRunState } from "@/lib/budget";
import { explorerUrl, shortAddr } from "@/lib/format";
import type { ProfileView as ProfileViewData } from "@/lib/profile-data";

// User profile page (Lot 1): identity + on-chain positions + launched projects +
// the creator's agent log/decisions. Read-only for visitors; the owner (connected
// wallet === profile wallet) gets inline editing via a signed `looplabs.fun
// profile` proof. Twitter linking lands in Lot 2 (Privy).

function compactNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

type LogFilter = "all" | "ship" | "decision" | "escalation";

export function ProfileView({ data }: { data: ProfileViewData }) {
  const wallet = useWallet();
  const router = useRouter();
  const { profile, launched, positions, log } = data;
  const isOwner = wallet.connected && wallet.address === profile.wallet;
  const isFounder = launched.length > 0;
  const escalations = log.filter((l) => l.kind === "escalation").length;

  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<LogFilter>("all");
  const shownLog = filter === "all" ? log : log.filter((l) => l.kind === filter);

  const name = profile.displayName || shortAddr(profile.wallet);

  return (
    <div className="min-h-screen">
      <nav className="border-b border-line max-w-[1280px] mx-auto px-6 sm:px-8 h-[60px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-[10px]">
          <LoopMark width={24} height={15} stroke="var(--accent)" />
          <span className="font-display font-bold text-[16px] tracking-[-0.02em]">Loop</span>
        </Link>
        <button
          onClick={wallet.toggle}
          className="font-mono text-[12px] px-3 py-[7px] rounded-[10px] border border-line-3 hover:border-line-hover transition-colors"
        >
          {wallet.label}
        </button>
      </nav>

      <main className="max-w-[860px] mx-auto px-6 sm:px-8 py-7 flex flex-col gap-4">
        {/* Identity */}
        <div className="bg-surface border border-line-2 rounded-[16px] px-6 py-5 flex gap-5 items-start flex-wrap">
          <Avatar url={profile.avatarUrl} name={name} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-[9px] flex-wrap">
              <span className="font-display font-bold text-[20px] tracking-[-0.02em]">{name}</span>
              {isFounder && (
                <span className="font-mono text-[10px] px-2 py-[3px] rounded-[6px] bg-accent text-white">FOUNDER</span>
              )}
              {profile.twitterHandle ? (
                <a
                  href={`https://x.com/${profile.twitterHandle.replace(/^@/, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[11.5px] text-accent-text inline-flex items-center gap-[4px] hover:underline"
                >
                  @{profile.twitterHandle.replace(/^@/, "")}
                  {profile.twitterVerified && <span className="text-pos" title="verified">✓</span>}
                </a>
              ) : isOwner ? (
                <span
                  className="font-mono text-[11px] text-faint"
                  title="Linking Twitter via Privy is coming next"
                >
                  + link Twitter (soon)
                </span>
              ) : null}
            </div>
            <a
              href={explorerUrl(profile.wallet, "mainnet")}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[12px] text-muted hover:text-accent-text transition-colors"
            >
              {shortAddr(profile.wallet)} ↗
            </a>
            {profile.bio && <p className="text-[13px] text-body mt-2 mb-0 max-w-[520px] leading-[1.5]">{profile.bio}</p>}
          </div>
          {isOwner && (
            <button
              onClick={() => setEditing(true)}
              className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] border border-line-2 hover:bg-surface-2 transition-colors"
            >
              Edit profile
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="positions" value={String(positions.length)} />
          <Stat label="launched" value={String(launched.length)} />
          <Stat label="needs you" value={String(escalations)} accent={escalations > 0} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Positions */}
          <Panel title="Positions" hint="on-chain">
            {positions.length === 0 ? (
              <Empty>No Loop tokens held.</Empty>
            ) : (
              positions.map((p) => (
                <Link
                  key={p.key}
                  href={`/token?p=${p.key}`}
                  className="flex items-center justify-between py-[9px] border-b border-line-4 last:border-0 hover:opacity-80"
                >
                  <div>
                    <div className="text-[13px] font-medium">{p.name}</div>
                    <div className="font-mono text-[11px] text-accent-text">{p.ticker}</div>
                  </div>
                  <div className="font-mono text-[12.5px] text-muted">{compactNum(p.amount)}</div>
                </Link>
              ))
            )}
          </Panel>

          {/* Launched projects */}
          <Panel title="Launched projects" hint="creator">
            {launched.length === 0 ? (
              <Empty>Hasn&apos;t launched a project yet.</Empty>
            ) : (
              launched.map((p) => {
                const state = agentRunState(p);
                return (
                  <Link
                    key={p.key}
                    href={`/token?p=${p.key}`}
                    className="block border border-line-4 rounded-[12px] px-3 py-[10px] mb-2 last:mb-0 hover:border-line-hover transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[14px] font-medium">
                        {p.name} <span className="font-mono text-[11px] text-accent-text">{p.ticker}</span>
                      </span>
                      <StateDot state={state} />
                    </div>
                    <div className="font-mono text-[11px] text-muted mt-[6px] flex gap-3">
                      <span>mcap {p.marketCap}</span>
                      <span>treasury {p.treasurySol.toFixed(3)}◎</span>
                    </div>
                  </Link>
                );
              })
            )}
          </Panel>
        </div>

        {/* Log & decisions */}
        {log.length > 0 && (
          <Panel
            title="Log & decisions"
            right={
              <div className="flex gap-[6px]">
                {(["all", "ship", "decision", "escalation"] as LogFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`font-mono text-[11px] px-2 py-[2px] rounded-[6px] border ${
                      filter === f
                        ? "bg-accent-tint text-accent-text border-accent-tint-border"
                        : "border-line-2 text-muted hover:bg-surface-2"
                    }`}
                  >
                    {f === "ship" ? "ships" : f === "decision" ? "decisions" : f === "escalation" ? "escalations" : "all"}
                  </button>
                ))}
              </div>
            }
          >
            {shownLog.map((l, i) => (
              <div key={i} className="flex items-start gap-3 py-[9px] border-b border-line-4 last:border-0">
                <LogIcon kind={l.kind} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] leading-[1.4]">{l.text}</div>
                  <div className="font-mono text-[10.5px] text-faint mt-[2px]">
                    {l.ticker} · {l.status}
                    {l.at && ` · ${l.at}`}
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        )}
      </main>

      {editing && isOwner && (
        <EditModal profile={profile} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); router.refresh(); }} />
      )}
    </div>
  );
}

function EditModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: ProfileViewData["profile"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const wallet = useWallet();
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const proof = await wallet.signProfileProof(profile.wallet);
      if (!proof) {
        setErr("This wallet can't sign (connect Phantom/Solflare).");
        return;
      }
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: profile.wallet, proof, displayName, bio, avatarUrl }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "save failed");
        return;
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/30 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-line-2 rounded-[16px] px-6 py-5 w-full max-w-[440px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="font-display font-semibold text-[16px] mb-4">Edit profile</div>
        {err && <div className="text-[12px] text-neg font-mono mb-3">{err}</div>}
        <label className="block text-[11px] text-faint font-mono uppercase tracking-[0.04em] mb-1">Display name</label>
        <input className="loop-input mb-3" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} placeholder="satoshi.loop" />
        <label className="block text-[11px] text-faint font-mono uppercase tracking-[0.04em] mb-1">Avatar URL</label>
        <input className="loop-input mb-3" value={avatarUrl} maxLength={400} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
        <label className="block text-[11px] text-faint font-mono uppercase tracking-[0.04em] mb-1">Bio</label>
        <textarea className="loop-input mb-4" value={bio} maxLength={160} rows={3} onChange={(e) => setBio(e.target.value)} placeholder="What you're building on Loop." />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="font-mono text-[12px] px-3 h-[36px] rounded-[10px] border border-line-2 hover:bg-surface-2">Cancel</button>
          <button
            onClick={save}
            disabled={busy}
            className="font-display font-semibold text-[13px] px-4 h-[36px] rounded-[10px] bg-accent text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Check your wallet…" : "Sign & save"}
          </button>
        </div>
        <p className="text-[11px] text-faint mt-3 leading-[1.4]">
          Saving asks your wallet to sign a free message proving you own this wallet — it moves no funds.
        </p>
      </div>
    </div>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="w-[64px] h-[64px] rounded-[18px] object-cover border border-line-2 flex-none" />;
  }
  return (
    <div className="w-[64px] h-[64px] rounded-[18px] bg-accent-tint border border-accent-tint-border flex items-center justify-center text-accent-text font-display font-bold text-[26px] flex-none">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-surface border border-line-2 rounded-[12px] px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.04em] text-faint font-mono">{label}</div>
      <div className={`font-display font-bold text-[19px] mt-[2px] ${accent ? "text-accent-text" : ""}`}>{value}</div>
    </div>
  );
}

function Panel({
  title,
  hint,
  right,
  children,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-display font-semibold text-[15px]">{title}</span>
        {right ?? (hint && <span className="text-[10px] uppercase tracking-[0.04em] text-faint font-mono">{hint}</span>)}
      </div>
      {children}
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
    <span className="font-mono text-[10px] inline-flex items-center gap-[5px]" style={{ color: s.c }}>
      <span className="w-[7px] h-[7px] rounded-full" style={{ background: s.c }} />
      {s.t}
    </span>
  );
}

function LogIcon({ kind }: { kind: "ship" | "decision" | "escalation" }) {
  const map = {
    ship: { bg: "var(--accent-tint)", c: "var(--accent-text)", ch: "↑" },
    decision: { bg: "var(--accent-tint)", c: "var(--accent-text)", ch: "✓" },
    escalation: { bg: "oklch(0.96 0.03 25)", c: "var(--neg)", ch: "!" },
  } as const;
  const m = map[kind];
  return (
    <span
      className="w-[24px] h-[24px] rounded-[7px] flex items-center justify-center text-[13px] flex-none mt-[1px] font-mono"
      style={{ background: m.bg, color: m.c }}
    >
      {m.ch}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] text-faint py-2">{children}</div>;
}
