"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoopMark } from "../LoopMark";
import { useWallet } from "@/lib/wallet";
import dynamic from "next/dynamic";
import { agentRunState } from "@/lib/budget";
import { explorerUrl, shortAddr, compactUsd } from "@/lib/format";
import { NavUserActions } from "../NavUserActions";
import { FollowButton } from "../FollowButton";
import { apiEstablishSession } from "@/lib/social-client";
import type { ProfileView as ProfileViewData } from "@/lib/profile-data";
import type { SocialUser } from "@/lib/social";

// Twitter linking (Privy) only works when the user-side Privy layer is configured.
// Lazy-loaded so the heavy Privy SDK never enters the base profile bundle — it
// loads on demand only when an owner opens the edit modal with Privy enabled.
const PRIVY_ON = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
const TwitterLink = dynamic(() => import("./TwitterLink").then((m) => m.TwitterLink), { ssr: false });

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

// USD for portfolio/position figures: cents under $1k (so a $0.61 bag reads
// honestly), compact K/M above — compactUsd alone rounds small values to whole $.
function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1000) return compactUsd(n);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type LogFilter = "all" | "ship" | "decision" | "escalation";

export function ProfileView({ data }: { data: ProfileViewData }) {
  const wallet = useWallet();
  const router = useRouter();
  const { profile, launched, positions, portfolioUsd, builder, follow, followers, followingList, log } = data;
  const isOwner = wallet.connected && wallet.address === profile.wallet;
  const isFounder = launched.length > 0;
  const escalations = log.filter((l) => l.kind === "escalation").length;

  // Local follower count so the Follow button updates the header optimistically.
  const [youFollow, setYouFollow] = useState(follow.youFollow);
  const [followerCount, setFollowerCount] = useState(follow.followers);

  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<LogFilter>("all");
  const shownLog = filter === "all" ? log : log.filter((l) => l.kind === filter);

  const name = profile.displayName || shortAddr(profile.wallet);
  const joined = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;

  return (
    <div className="min-h-screen">
      <nav className="border-b border-line max-w-[1280px] mx-auto px-6 sm:px-8 h-[60px] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-[10px]">
          <LoopMark width={24} height={15} stroke="var(--accent)" />
          <span className="font-display font-bold text-[16px] tracking-[-0.02em]">Loop</span>
        </Link>
        <div className="flex items-center gap-[8px]">
          <NavUserActions messagesHidden />
          <button
            onClick={wallet.toggle}
            className="font-mono text-[12px] px-3 py-[7px] rounded-[10px] border border-line-3 hover:border-line-hover transition-colors"
          >
            {wallet.label}
          </button>
        </div>
      </nav>

      <main className="max-w-[920px] mx-auto px-6 sm:px-8 py-7 flex flex-col gap-4">
        {/* Identity — a cover band the avatar sits on, then name + role + meta. */}
        <div className="bg-surface border border-line-2 rounded-[18px] overflow-hidden">
          <div
            className="h-[88px]"
            style={{
              background:
                "linear-gradient(110deg, oklch(0.96 0.04 285) 0%, oklch(0.94 0.06 285) 45%, oklch(0.965 0.018 285) 100%)",
            }}
          />
          <div className="px-6 pb-5">
            {/* Row 1 — avatar straddles the band; the action button sits opposite
                it. Kept on its own row so a long display name can never collide
                with the button (it lives full-width below). */}
            <div className="-mt-[34px] flex items-end justify-between gap-3">
              <Avatar url={profile.avatarUrl} name={name} />
              <div className="pb-[2px]">
                {isOwner ? (
                  <button
                    onClick={() => setEditing(true)}
                    className="font-mono text-[12px] px-3 py-[8px] rounded-[10px] border border-line-2 bg-surface hover:bg-surface-2 transition-colors"
                  >
                    Edit profile
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    {wallet.connected && (
                      <Link
                        href={`/messages?to=${profile.wallet}`}
                        className="font-mono text-[12px] px-3 h-[36px] inline-flex items-center rounded-[10px] border border-line-2 bg-surface hover:bg-surface-2 transition-colors"
                      >
                        Message
                      </Link>
                    )}
                    <FollowButton
                      target={profile.wallet}
                      following={youFollow}
                      onChange={(now) => {
                        setYouFollow(now);
                        setFollowerCount((c) => Math.max(0, c + (now ? 1 : -1)));
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            {/* Row 2 — identity, full width below. */}
            <div className="mt-3 min-w-0">
              <div className="flex items-center gap-[9px] flex-wrap">
                <span className="font-display font-bold text-[22px] tracking-[-0.02em] leading-none break-all">{name}</span>
                {isFounder && <RoleChip kind="founder" />}
                {positions.length > 0 && <RoleChip kind="holder" />}
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
                  PRIVY_ON ? (
                    <button
                      onClick={() => setEditing(true)}
                      className="font-mono text-[11px] text-accent-text hover:underline"
                    >
                      + link X
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] text-faint" title="Linking X via Privy is coming next">
                      + link X (soon)
                    </span>
                  )
                ) : null}
              </div>
              {profile.username && (
                <div className="font-mono text-[13px] text-accent-text mt-[5px]">@{profile.username}</div>
              )}
              <div className="flex items-center gap-3 mt-[7px] flex-wrap">
                <CopyWallet wallet={profile.wallet} />
                {joined && <span className="font-mono text-[11px] text-faint">· since {joined}</span>}
              </div>
              {/* Social proof — follower/following counts, inline under identity. */}
              <div className="flex items-center gap-4 mt-[10px]">
                <span className="text-[13px]">
                  <span className="font-display font-bold tabular-nums">{followerCount}</span>{" "}
                  <span className="text-muted">{followerCount === 1 ? "follower" : "followers"}</span>
                </span>
                <span className="text-[13px]">
                  <span className="font-display font-bold tabular-nums">{follow.following}</span>{" "}
                  <span className="text-muted">following</span>
                </span>
              </div>
              {profile.bio && (
                <p className="text-[13px] text-body mt-[10px] mb-0 max-w-[560px] leading-[1.5]">{profile.bio}</p>
              )}
            </div>
          </div>
        </div>

        {/* Builder impact — the self-funding loop, summed across launched projects.
            Founder-only; it makes the platform's core thesis legible on a profile. */}
        {builder && <ImpactStrip builder={builder} escalations={escalations} />}

        {/* Portfolio summary — holders see their live worth on Loop up top. */}
        {positions.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="portfolio" value={portfolioUsd != null ? fmtUsd(portfolioUsd) : "—"} big />
            <Stat label="positions" value={String(positions.length)} />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Positions */}
          <Panel title="Positions" hint={portfolioUsd != null ? fmtUsd(portfolioUsd) : "on-chain"}>
            {positions.length === 0 ? (
              <Empty>No Loop tokens held yet.</Empty>
            ) : (
              positions.map((p) => (
                <Link
                  key={p.key}
                  href={`/token?p=${p.key}`}
                  className="flex items-center justify-between py-[10px] border-b border-line-4 last:border-0 group"
                >
                  <div className="flex items-center gap-[10px] min-w-0">
                    <TokenGlyph ticker={p.ticker} />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium group-hover:text-accent-text transition-colors truncate">{p.name}</div>
                      <div className="font-mono text-[11px] text-faint">{compactNum(p.amount)} {p.ticker.replace(/^\$/, "")}</div>
                    </div>
                  </div>
                  <div className="text-right flex-none">
                    {p.valueUsd != null ? (
                      <div className="font-mono text-[13px] tabular-nums">{fmtUsd(p.valueUsd)}</div>
                    ) : (
                      <div className="font-mono text-[12px] text-faint">{p.network === "devnet" ? "devnet" : "—"}</div>
                    )}
                  </div>
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

        {/* Network — who follows this wallet and who it follows. The social graph
            made browsable; each row links to that wallet's profile. */}
        {(followers.length > 0 || followingList.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Panel title="Followers" hint={String(follow.followers)}>
              {followers.length === 0 ? <Empty>No followers yet.</Empty> : followers.map((u) => <SocialRow key={u.wallet} user={u} />)}
            </Panel>
            <Panel title="Following" hint={String(follow.following)}>
              {followingList.length === 0 ? (
                <Empty>Not following anyone yet.</Empty>
              ) : (
                followingList.map((u) => <SocialRow key={u.wallet} user={u} />)
              )}
            </Panel>
          </div>
        )}

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
  const [username, setUsername] = useState(profile.username ?? "");
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function ensureSession(): Promise<boolean> {
    if (!wallet.address) return false;
    const proof = await wallet.signProfileProof(profile.wallet);
    return Boolean(proof && (await apiEstablishSession(wallet.address, proof)));
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setErr(null);
    setUploading(true);
    try {
      const send = async () => {
        const fd = new FormData();
        fd.append("file", file);
        return fetch("/api/profile/avatar", { method: "POST", body: fd });
      };
      let r = await send();
      if (r.status === 401 && (await ensureSession())) r = await send();
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "upload failed");
        return;
      }
      setAvatarUrl(j.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }

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
        body: JSON.stringify({ wallet: profile.wallet, proof, username, displayName, bio, avatarUrl }),
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
        <label className="block text-[11px] text-faint font-mono uppercase tracking-[0.04em] mb-1">Username</label>
        <div className="relative mb-3">
          <span className="absolute left-[12px] top-1/2 -translate-y-1/2 font-mono text-[14px] text-faint">@</span>
          <input
            className="loop-input pl-[26px]"
            value={username}
            maxLength={20}
            onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
            placeholder="satoshi"
          />
        </div>
        <label className="block text-[11px] text-faint font-mono uppercase tracking-[0.04em] mb-1">Display name</label>
        <input className="loop-input mb-3" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} placeholder="satoshi.loop" />
        <label className="block text-[11px] text-faint font-mono uppercase tracking-[0.04em] mb-1">Avatar</label>
        <div className="flex items-center gap-3 mb-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="w-[48px] h-[48px] rounded-[12px] object-cover border border-line-2 flex-none" />
          ) : (
            <span className="w-[48px] h-[48px] rounded-[12px] bg-accent-tint border border-accent-tint-border flex items-center justify-center font-display font-bold text-[18px] text-accent-text flex-none">
              {(displayName || profile.wallet).slice(0, 1).toUpperCase()}
            </span>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onPickFile} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="font-mono text-[12px] px-3 h-[34px] rounded-[9px] border border-line-2 bg-surface hover:bg-surface-2 transition-colors disabled:opacity-60"
          >
            {uploading ? "Uploading…" : "Upload image"}
          </button>
          {avatarUrl && (
            <button type="button" onClick={() => setAvatarUrl("")} className="font-mono text-[11px] text-faint hover:text-neg transition-colors">
              remove
            </button>
          )}
        </div>
        <input className="loop-input mb-3" value={avatarUrl} maxLength={400} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="or paste an image URL" />
        <label className="block text-[11px] text-faint font-mono uppercase tracking-[0.04em] mb-1">Bio</label>
        <textarea className="loop-input mb-4" value={bio} maxLength={160} rows={3} onChange={(e) => setBio(e.target.value)} placeholder="What you're building on Loop." />
        <div className="border-t border-line-4 pt-4 mb-4">
          <label className="block text-[11px] text-faint font-mono uppercase tracking-[0.04em] mb-2">X / Twitter</label>
          {PRIVY_ON ? (
            <TwitterLink wallet={profile.wallet} currentHandle={profile.twitterHandle} onLinked={onSaved} />
          ) : (
            <div className="text-[12px] text-faint">
              {profile.twitterHandle ? `linked: @${profile.twitterHandle.replace(/^@/, "")}` : "Linking via Privy is being switched on — coming shortly."}
            </div>
          )}
        </div>
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
  const ring = "w-[76px] h-[76px] rounded-[22px] flex-none ring-4 ring-surface shadow-[0_2px_12px_oklch(0.47_0.21_285_/_0.14)]";
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className={`${ring} object-cover border border-line-2`} />;
  }
  return (
    <div
      className={`${ring} bg-accent-tint border border-accent-tint-border flex items-center justify-center text-accent-text font-display font-bold text-[30px]`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function RoleChip({ kind }: { kind: "founder" | "holder" }) {
  if (kind === "founder") {
    return (
      <span className="font-mono text-[10px] px-2 py-[3px] rounded-[6px] bg-accent text-white tracking-[0.02em]">FOUNDER</span>
    );
  }
  return (
    <span className="font-mono text-[10px] px-2 py-[3px] rounded-[6px] bg-accent-tint text-accent-text border border-accent-tint-border tracking-[0.02em]">
      HOLDER
    </span>
  );
}

function CopyWallet({ wallet }: { wallet: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() =>
          navigator.clipboard?.writeText(wallet).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            },
            () => {}
          )
        }
        title="Copy wallet address"
        className="group font-mono text-[12px] text-muted hover:text-accent-text transition-colors inline-flex items-center gap-[5px]"
      >
        {shortAddr(wallet)}
        <span className="text-faint group-hover:text-accent-text">{copied ? "✓" : "⧉"}</span>
      </button>
      <a
        href={explorerUrl(wallet, "mainnet")}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-[11px] text-faint hover:text-accent-text transition-colors"
      >
        explorer ↗
      </a>
    </span>
  );
}

// One wallet in a Followers/Following list: avatar + name (linking to its
// profile) plus an inline follow control. The button is a sibling of the link —
// never nested inside the <a> — so the two don't fight over the click.
function SocialRow({ user }: { user: SocialUser }) {
  const name = user.displayName || shortAddr(user.wallet);
  return (
    <div className="flex items-center gap-[10px] py-[9px] border-b border-line-4 last:border-0">
      <Link href={`/u/${user.wallet}`} className="flex items-center gap-[10px] min-w-0 flex-1 group">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt={name} className="w-[30px] h-[30px] rounded-[9px] object-cover border border-line-2 flex-none" />
        ) : (
          <span className="w-[30px] h-[30px] rounded-[9px] bg-accent-tint border border-accent-tint-border flex items-center justify-center font-display font-bold text-[13px] text-accent-text flex-none">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium group-hover:text-accent-text transition-colors truncate">{name}</div>
          {user.displayName && <div className="font-mono text-[10.5px] text-faint truncate">{shortAddr(user.wallet)}</div>}
        </div>
      </Link>
      <FollowButton target={user.wallet} following={user.youFollow} size="sm" />
    </div>
  );
}

// The self-funding loop, summed across a founder's projects — mirrors the token
// page's LoopProof so the platform's core thesis reads the same on a profile.
function ImpactStrip({
  builder,
  escalations,
}: {
  builder: NonNullable<ProfileViewData["builder"]>;
  escalations: number;
}) {
  const items: { value: string; label: string; accent?: boolean }[] = [
    { value: String(builder.shipped), label: builder.shipped === 1 ? "feature shipped" : "features shipped" },
    { value: `${builder.treasurySol.toFixed(3)}◎`, label: "treasury funding it" },
    { value: String(builder.liveTokens), label: builder.liveTokens === 1 ? "live token" : "live tokens" },
  ];
  if (escalations > 0) items.push({ value: String(escalations), label: "awaiting you", accent: true });
  return (
    <div className="rounded-[16px] border border-line-2 bg-surface px-5 py-4">
      <div className="text-[9.5px] uppercase tracking-[0.06em] text-faint mb-3">↻ self-funding loop · what your agents shipped</div>
      <div className="flex flex-wrap gap-x-9 gap-y-3">
        {items.map((it) => (
          <div key={it.label}>
            <div
              className={`font-display font-bold text-[22px] tracking-[-0.01em] tabular-nums leading-none ${
                it.accent ? "text-accent-text" : "text-ink"
              }`}
            >
              {it.value}
            </div>
            <div className="text-[10.5px] text-muted mt-[4px]">{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TokenGlyph({ ticker }: { ticker: string }) {
  return (
    <span className="w-[30px] h-[30px] rounded-[9px] bg-accent-tint border border-accent-tint-border flex items-center justify-center font-display font-bold text-[12px] text-accent-text flex-none">
      {ticker.replace(/^\$/, "").slice(0, 2).toUpperCase()}
    </span>
  );
}

function Stat({ label, value, accent, big }: { label: string; value: string; accent?: boolean; big?: boolean }) {
  return (
    <div className="bg-surface border border-line-2 rounded-[14px] px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.04em] text-faint font-mono">{label}</div>
      <div
        className={`font-display font-bold mt-[2px] tabular-nums ${big ? "text-[24px]" : "text-[19px]"} ${
          accent ? "text-accent-text" : ""
        }`}
      >
        {value}
      </div>
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
