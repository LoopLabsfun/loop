"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { shortAddr } from "@/lib/format";
import type { AdminSnapshot, AdminTaskRow } from "@/lib/admin-data";

// founder/agent/platform split label from the single founder lever (platform = 5).
const splitOf = (f: number | null) => `${f ?? 30}/${100 - 5 - (f ?? 30)}/5`;

interface Draft {
  wallet: string;
  name: string;
  ticker: string;
  status: string;
  email: string | null;
  xHandle: string | null;
  prompt: string | null;
  repo: string | null;
  bannerUrl: string | null;
  tokenImageUrl: string | null;
  feeFounderPct: number | null;
  projectKey: string | null;
  projectWallet: string | null;
  createdAt: string;
}
interface Funding {
  projectWallet: string | null;
  totalSol: number;
  backers: number;
}
interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

// FOUNDER ADMIN CONSOLE (founder-only, hidden) — the live, self-serve view of the
// agent the founder asked for: status + a unified feed of what it's doing, what's
// queued, what's waiting on a sign-off, plus the safe interactive controls
// (pause / resume / force a tick / resolve an escalation). Auth is a wallet
// signature gated on creator_wallet (lib/admin-session); the log polls a founder-
// gated endpoint. No new infra — it reads the agent_* tables already in Supabase.
export const dynamic = "force-dynamic";

const KEY = "loop";

export default function AdminPage() {
  const wallet = useWallet();
  const [authed, setAuthed] = useState(false);
  const [snap, setSnap] = useState<AdminSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/log?p=${KEY}`, { cache: "no-store" });
      if (r.status === 401) {
        setAuthed(false);
        return;
      }
      if (r.ok) {
        setSnap((await r.json()) as AdminSnapshot);
        setAuthed(true);
      }
    } catch {
      /* transient — keep last snapshot */
    } finally {
      setChecked(true);
    }
  }, []);

  // On mount, try the log: a still-valid session cookie skips the wallet prompt.
  useEffect(() => {
    load();
  }, [load]);

  // Poll while authed.
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [authed, load]);

  async function signIn() {
    setErr(null);
    setBusy("signin");
    try {
      const proof = await wallet.signAdminProof(KEY);
      if (!proof) {
        setErr("This wallet can't sign (connect Phantom/Solflare).");
        return;
      }
      const r = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: KEY, proof }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "sign-in failed");
        return;
      }
      setAuthed(true);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "sign-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function control(body: Record<string, unknown>, tag: string) {
    setErr(null);
    setBusy(tag);
    try {
      const r = await fetch("/api/admin/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: KEY, ...body }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "action failed");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "action failed");
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuthed(false);
    setSnap(null);
  }

  return (
    <main className="min-h-screen max-w-[1100px] mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-display font-bold text-[22px] tracking-[-0.02em]">Admin console</h1>
          <span className="font-mono text-[10.5px] px-2 py-[3px] rounded-[6px] bg-accent text-white">FOUNDER</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/v2"
            className="font-mono text-[12px] px-3 py-[6px] rounded-[8px] border border-line-2 hover:bg-surface-2 transition-colors"
          >
            Preview Loop v2 →
          </Link>
          {authed && (
            <button
              onClick={signOut}
              className="font-mono text-[12px] px-3 py-[6px] rounded-[8px] border border-line-2 hover:bg-surface-2 transition-colors"
            >
              Sign out
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="mb-4 text-[12.5px] text-neg bg-surface border border-neg/40 rounded-[10px] px-4 py-2 font-mono">
          {err}
        </div>
      )}

      {!authed ? (
        <div className="bg-surface border border-line-2 rounded-[16px] px-6 py-8 text-center">
          <div className="font-display font-semibold text-[16px] mb-1">Founder sign-in</div>
          <p className="text-[13px] text-muted max-w-[420px] mx-auto mb-5">
            This console is private. Prove you're the founder by signing a message with the
            project's creator wallet — it moves no funds and just opens a 2-hour session.
          </p>
          {!wallet.connected ? (
            <button
              onClick={wallet.connect}
              className="font-display font-semibold text-[14px] px-5 h-[40px] rounded-[10px] bg-accent text-white hover:opacity-90 transition-opacity"
            >
              Connect wallet
            </button>
          ) : (
            <button
              onClick={signIn}
              disabled={busy === "signin"}
              className="font-display font-semibold text-[14px] px-5 h-[40px] rounded-[10px] bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {busy === "signin" ? "Check your wallet…" : `Sign in as founder (${wallet.label})`}
            </button>
          )}
          {checked && (
            <p className="text-[11px] text-faint mt-4">
              The signer must equal this project's creator_wallet, or sign-in is rejected.
            </p>
          )}
        </div>
      ) : !snap ? (
        <div className="text-[13px] text-muted font-mono">Loading…</div>
      ) : (
        <Console snap={snap} busy={busy} control={control} />
      )}
    </main>
  );
}

function Console({
  snap,
  busy,
  control,
}: {
  snap: AdminSnapshot;
  busy: string | null;
  control: (body: Record<string, unknown>, tag: string) => Promise<void>;
}) {
  const s = snap.status;
  const ago = (ms: number | null) =>
    ms == null ? "never" : `${Math.round((Date.now() - ms) / 60000)}m ago`;
  return (
    <div className="flex flex-col gap-4">
      {/* Pre-launch curation — drafts from the waitlist, preflight + approve&mint. */}
      <PrelaunchPanel />

      {/* Status + controls */}
      <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Dot ok={s.paused ? false : s.awake} />
            <span className="font-display font-semibold text-[15px]">
              {s.paused ? "Paused" : s.awake ? "Awake" : "Asleep"}
            </span>
            {s.reason && <span className="text-[12px] text-muted">· {s.reason}</span>}
            <span className="font-mono text-[10.5px] px-2 py-[2px] rounded-[6px] bg-surface-2 text-muted">
              brain: {s.brain}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {s.paused ? (
              <button
                onClick={() => control({ action: "resume" }, "resume")}
                disabled={!!busy}
                className="font-mono text-[12px] px-3 h-[32px] rounded-[8px] bg-accent text-white hover:opacity-90 disabled:opacity-60"
              >
                {busy === "resume" ? "…" : "Resume"}
              </button>
            ) : (
              <button
                onClick={() => control({ action: "pause" }, "pause")}
                disabled={!!busy}
                className="font-mono text-[12px] px-3 h-[32px] rounded-[8px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
              >
                {busy === "pause" ? "…" : "Pause"}
              </button>
            )}
            <button
              onClick={() => control({ action: "force-tick" }, "force")}
              disabled={!!busy || s.paused}
              title={s.paused ? "Resume first" : "Run one tick now (bypasses cooldown — costs compute)"}
              className="font-mono text-[12px] px-3 h-[32px] rounded-[8px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
            >
              {busy === "force" ? "Ticking…" : "Force tick"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          <Stat label="Treasury" value={`${s.treasurySol.toFixed(4)} SOL`} />
          <Stat label="Last tick" value={ago(s.lastTickAt)} />
          <Stat label="Cooldown" value={`${Math.round(s.cooldownMs / 60000)}m`} />
          <Stat
            label="Queue"
            value={`${s.counts.todo} todo · ${s.counts.building} building`}
          />
        </div>
      </div>

      {/* Waiting on founder — escalations */}
      {snap.escalations.length > 0 && (
        <Panel title={`Waiting on you · ${snap.escalations.length}`} accent>
          <div className="flex flex-col gap-2">
            {snap.escalations.map((e) => (
              <div
                key={e.id}
                className="flex items-start justify-between gap-3 border border-line-4 rounded-[10px] px-3 py-2"
              >
                <span className="text-[12.5px] text-ink leading-[1.4]">{e.body}</span>
                <div className="flex gap-1 flex-none">
                  <button
                    onClick={() => control({ action: "escalation", id: e.id, decision: "adopted" }, `esc-${e.id}`)}
                    disabled={!!busy}
                    className="font-mono text-[11px] px-2 h-[28px] rounded-[7px] bg-accent text-white hover:opacity-90 disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => control({ action: "escalation", id: e.id, decision: "declined" }, `esc-${e.id}`)}
                    disabled={!!busy}
                    className="font-mono text-[11px] px-2 h-[28px] rounded-[7px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Building now */}
      {snap.building.length > 0 && (
        <Panel title={`Building now · ${snap.building.length}`}>
          <TaskList rows={snap.building} />
        </Panel>
      )}

      {/* Queue */}
      <Panel title={`Up next · ${snap.todo.length}`}>
        {snap.todo.length ? <TaskList rows={snap.todo} /> : <Empty>Queue is empty.</Empty>}
      </Panel>

      {/* Recently shipped */}
      <Panel title="Recently shipped">
        {snap.shipped.length ? <TaskList rows={snap.shipped} shipped /> : <Empty>Nothing shipped yet.</Empty>}
      </Panel>

      {/* Blocked */}
      {snap.blocked.length > 0 && (
        <Panel title={`Blocked · ${snap.blocked.length}`}>
          <TaskList rows={snap.blocked} />
        </Panel>
      )}

      {/* Learnings */}
      {snap.learnings.length > 0 && (
        <Panel title="Recent learnings">
          <div className="flex flex-col gap-1.5">
            {snap.learnings.map((l, i) => (
              <div key={i} className="text-[12.5px] text-muted leading-[1.45]">
                <span className="font-mono text-[10.5px] text-accent-text mr-2">{l.category}</span>
                {l.insight}
              </div>
            ))}
          </div>
        </Panel>
      )}
      <p className="text-[11px] text-faint text-center mt-2">Auto-refreshes every 15s.</p>
    </div>
  );
}

function PrelaunchPanel() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `${wallet}:${action}`
  const [pf, setPf] = useState<Record<string, { ready: boolean; checks: Check[] }>>({});
  const [fund, setFund] = useState<Record<string, Funding>>({});
  const [result, setResult] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/prelaunch", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "load failed");
      setDrafts(j.drafts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function preflight(wallet: string) {
    setBusy(`${wallet}:preflight`);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/prelaunch?wallet=${wallet}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "preflight failed");
      setPf((p) => ({ ...p, [wallet]: { ready: j.ready, checks: j.checks } }));
      if (j.funding) setFund((f) => ({ ...f, [wallet]: j.funding }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "preflight failed");
    } finally {
      setBusy(null);
    }
  }

  async function sync(wallet: string) {
    setBusy(`${wallet}:sync`);
    setErr(null);
    try {
      const r = await fetch("/api/admin/prelaunch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, action: "sync" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "sync failed");
      if (j.funding) setFund((f) => ({ ...f, [wallet]: j.funding }));
      setResult((m) => ({ ...m, [wallet]: `Synced · +${j.added} new · ${j.funding?.totalSol ?? 0} SOL raised` }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function act(wallet: string, action: string, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(`${wallet}:${action}`);
    setErr(null);
    try {
      const r = await fetch("/api/admin/prelaunch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, action, confirm: action === "approve" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${action} failed`);
      if (action === "approve") {
        setResult((m) => ({
          ...m,
          [wallet]: `Launched → ${j.key}${j.mint ? ` · ${j.mint.slice(0, 4)}…${j.mint.slice(-4)}` : ""}${j.simulated ? " (simulated)" : ""}`,
        }));
      }
      if (j.refund) {
        setResult((m) => ({ ...m, [wallet]: `Refund: ${j.refund.note}` }));
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${action} failed`);
    } finally {
      setBusy(null);
    }
  }

  const n = drafts?.length ?? 0;
  return (
    <Panel title={`Pre-launch · ${n}`} accent>
      {err && <div className="text-[12px] text-neg font-mono mb-2">{err}</div>}
      {drafts == null ? (
        <Empty>Loading…</Empty>
      ) : n === 0 ? (
        <Empty>No drafts yet.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {drafts.map((d) => {
            const isBusy = (a: string) => busy === `${d.wallet}:${a}`;
            const launched = d.status === "launched";
            const p = pf[d.wallet];
            return (
              <div key={d.wallet} className="border border-line-3 rounded-[10px] p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {d.tokenImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.tokenImageUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-line-3" />
                  )}
                  <span className="font-display font-semibold text-[14px]">{d.name}</span>
                  <span className="font-mono text-[12px] text-accent-text">${d.ticker}</span>
                  <span className="font-mono text-[10px] px-2 py-[2px] rounded-full bg-surface-2 text-muted">{d.status}</span>
                  <span className="font-mono text-[11px] text-faint ml-auto">{shortAddr(d.wallet)}</span>
                </div>
                <div className="text-[11.5px] text-faint font-mono mt-1">
                  {[d.xHandle ? `@${d.xHandle}` : "", d.email ?? "", `split ${splitOf(d.feeFounderPct)}`].filter(Boolean).join("  ·  ")}
                </div>
                {d.prompt && <div className="text-[12px] text-muted mt-1">{d.prompt}</div>}

                {d.projectWallet && (
                  <div className="mt-2 text-[11.5px] font-mono flex items-center gap-2 flex-wrap">
                    <span className="text-faint">treasury</span>
                    <span className="text-body">{shortAddr(d.projectWallet)}</span>
                    {fund[d.wallet] && (
                      <span className="text-pos">
                        · {fund[d.wallet].totalSol} SOL pre-funded · {fund[d.wallet].backers} backer{fund[d.wallet].backers === 1 ? "" : "s"}
                      </span>
                    )}
                    <Btn onClick={() => sync(d.wallet)} busy={isBusy("sync")}>Sync funding</Btn>
                  </div>
                )}

                {p && (
                  <div className="mt-2 flex flex-col gap-[2px]">
                    {p.checks.map((c, i) => (
                      <div key={i} className="font-mono text-[11px] flex items-center gap-2">
                        <span className={c.ok ? "text-pos" : "text-neg"}>{c.ok ? "✓" : "✗"}</span>
                        <span className="text-body">{c.label}</span>
                        <span className="text-faint">{c.detail}</span>
                      </div>
                    ))}
                    <div className={`font-mono text-[11px] mt-1 ${p.ready ? "text-pos" : "text-neg"}`}>
                      {p.ready ? "READY ✓" : "NOT READY — fix the ✗ before minting"}
                    </div>
                  </div>
                )}

                {result[d.wallet] && <div className="text-[12px] text-pos font-mono mt-2">{result[d.wallet]}</div>}

                {!launched ? (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Btn onClick={() => preflight(d.wallet)} busy={isBusy("preflight")}>Preflight</Btn>
                    <Btn onClick={() => act(d.wallet, "whitelist")} busy={isBusy("whitelist")}>Whitelist</Btn>
                    <Btn
                      onClick={() =>
                        act(d.wallet, "reject", `Reject ${d.name} and refund its backers (if armed)?`)
                      }
                      busy={isBusy("reject")}
                    >
                      Reject
                    </Btn>
                    <Btn
                      onClick={() =>
                        act(d.wallet, "refund", `Refund all backers of ${d.name}? Sends real SOL from its wallet.`)
                      }
                      busy={isBusy("refund")}
                    >
                      Refund
                    </Btn>
                    <Btn
                      onClick={() =>
                        act(
                          d.wallet,
                          "approve",
                          `Launch ${d.name} ($${d.ticker}) for REAL? This mints on mainnet and spends the seed dev-buy SOL from the platform wallet.`,
                        )
                      }
                      busy={isBusy("approve")}
                      danger
                    >
                      Approve &amp; mint
                    </Btn>
                  </div>
                ) : (
                  d.projectKey && (
                    <a href={`/token?p=${d.projectKey}`} className="inline-block mt-2 font-mono text-[12px] text-accent-text hover:underline">
                      View project →
                    </a>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function Btn({ children, onClick, busy, danger }: { children: ReactNode; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`font-mono text-[11.5px] px-2.5 py-[5px] rounded-[8px] border transition-colors disabled:opacity-50 ${
        danger ? "border-neg/40 text-neg hover:bg-neg/10" : "border-line-2 hover:bg-surface-2"
      }`}
    >
      {busy ? "…" : children}
    </button>
  );
}

function TaskList({ rows, shipped }: { rows: AdminTaskRow[]; shipped?: boolean }) {
  return (
    <div className="flex flex-col">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-3 py-2 border-b border-line-4 last:border-0">
          <span
            className={`font-mono text-[10px] px-[6px] py-[2px] rounded-[5px] flex-none mt-[1px] ${
              shipped ? "bg-pos/10 text-pos" : "bg-surface-2 text-muted"
            }`}
          >
            {r.category}
          </span>
          <span className="text-[12.5px] text-ink leading-[1.4]">{r.title}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({
  title,
  accent,
  children,
}: {
  title: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`bg-surface border rounded-[16px] px-5 py-4 ${
        accent ? "border-accent/50" : "border-line-2"
      }`}
    >
      <div className="font-display font-semibold text-[14px] mb-3">{title}</div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.02em] text-faint">{label}</div>
      <div className="font-mono text-[13px] text-ink mt-[2px]">{value}</div>
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`w-[9px] h-[9px] rounded-full ${ok ? "bg-pos animate-pulseFast" : "bg-faint"}`}
    />
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[12.5px] text-faint py-1">{children}</div>;
}
