"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { shortAddr, cashtag } from "@/lib/format";
import type { AdminSnapshot, AdminTaskRow } from "@/lib/admin-data";
import type { TreasuryDiag } from "@/lib/treasury-diag";
import type { ProvisioningChecklist } from "@/lib/provisioning-check";
import type { KnobView } from "@/lib/project-config";
import { ProjectDomainManager } from "@/components/token/ProjectDomainManager";

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
  homeKey: string | null;
  homeRepo: string | null;
  homeVercelUrl: string | null;
  chain: "solana" | "hood";
  createdAt: string;
}
interface Funding {
  projectWallet: string | null;
  totalSol: number;
  backers: number;
}
// Editable subset of a pre-launch draft (mirrors DraftFieldPatch on the server).
interface DraftFields {
  name?: string;
  ticker?: string;
  prompt?: string;
  repo?: string;
  feeFounderPct?: number;
}
// A launched project as the platform-admin sees it (mirrors AdminProjectRow).
interface AdminProject {
  key: string;
  name: string;
  ticker: string;
  description: string | null;
  prompt: string | null;
  repo: string | null;
  cover: string | null;
  guardrails: string | null;
  contentPolicy: string | null;
  feeFounderPct: number | null;
  splitLabel: string;
  official: boolean;
  network: string | null;
  mint: string | null;
  creatorWallet: string | null;
  treasuryWallet: string | null;
  agentWallet: string | null;
  agentPaused: boolean;
  hasAgentKey: boolean;
  treasurySol: number | null;
  earnedSol: number | null;
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  website: string | null;
  tokenImageUrl: string | null;
  bannerUrl: string | null;
  domain: string | null;
}
// Editable subset of a launched project (mirrors ProjectFieldPatch on the server).
interface ProjectFields {
  name?: string;
  description?: string;
  prompt?: string;
  repo?: string;
  cover?: string;
  guardrails?: string;
  contentPolicy?: string;
  feeFounderPct?: number;
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
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

const DEFAULT_KEY = "loop";

export default function AdminPage() {
  const wallet = useWallet();
  const [authed, setAuthed] = useState(false);
  const [snap, setSnap] = useState<AdminSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  // Which project's ops the founder is viewing. The session cookie is wallet-
  // bound (not project-bound), so a founder who signed in for loop can switch to
  // any project sharing the same creator_wallet without re-signing — the log/
  // control routes re-bind to each project's creator_wallet (isFounder).
  const [key, setKey] = useState<string>(DEFAULT_KEY);
  const [opsKeys, setOpsKeys] = useState<string[]>([DEFAULT_KEY]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/log?p=${key}`, { cache: "no-store" });
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
  }, [key]);

  // On mount, try the log: a still-valid session cookie skips the wallet prompt.
  useEffect(() => {
    load();
  }, [load]);

  // Once authed, fetch the set of projects this founder can administer (same
  // creator_wallet) so we can offer ops tabs for each — not just loop.
  useEffect(() => {
    if (!authed) return;
    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/projects", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { projects?: { key: string }[] };
        const keys = (j.projects ?? []).map((p) => p.key);
        if (live && keys.length) {
          setOpsKeys(keys.includes(DEFAULT_KEY) ? keys : [DEFAULT_KEY, ...keys]);
        }
      } catch {
        /* keep the default single tab */
      }
    })();
    return () => {
      live = false;
    };
  }, [authed]);

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
      const proof = await wallet.signAdminProof(key);
      if (!proof) {
        setErr("This wallet can't sign (connect Phantom/Solflare).");
        return;
      }
      const r = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, proof }),
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
        body: JSON.stringify({ key, ...body }),
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
            This console is private. Prove you&apos;re the founder by signing a message with the
            project&apos;s creator wallet — it moves no funds and just opens a 2-hour session.
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
              The signer must equal this project&apos;s creator_wallet, or sign-in is rejected.
            </p>
          )}
        </div>
      ) : !snap ? (
        <div className="text-[13px] text-muted font-mono">Loading…</div>
      ) : (
        <Console
          snap={snap}
          busy={busy}
          control={control}
          activeKey={key}
          opsKeys={opsKeys}
          onSwitch={setKey}
        />
      )}
    </main>
  );
}

function Console({
  snap,
  busy,
  control,
  activeKey,
  opsKeys,
  onSwitch,
}: {
  snap: AdminSnapshot;
  busy: string | null;
  control: (body: Record<string, unknown>, tag: string) => Promise<void>;
  activeKey: string;
  opsKeys: string[];
  onSwitch: (key: string) => void;
}) {
  const s = snap.status;
  const ago = (ms: number | null) =>
    ms == null ? "never" : `${Math.round((Date.now() - ms) / 60000)}m ago`;
  return (
    <div className="flex flex-col gap-4">
      {/* Pre-launch curation — drafts from the waitlist, preflight + approve&mint. */}
      <PrelaunchPanel />

      {/* Platform-admin control over EVERY launched project — fields, fee split,
          per-project agent API key, pause/resume (third-party projects included). */}
      <ProjectsPanel />

      {/* Ops project switcher — the panels below (status / tasks / backlog /
          reconcile / force-tick) act on the SELECTED project, not just loop. */}
      {opsKeys.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] text-faint">Agent ops:</span>
          {opsKeys.map((k) => (
            <button
              key={k}
              onClick={() => onSwitch(k)}
              disabled={!!busy}
              className={`font-mono text-[12px] px-3 h-[28px] rounded-[8px] border transition-colors disabled:opacity-60 ${
                k === activeKey
                  ? "bg-accent text-white border-accent"
                  : "border-line-2 hover:bg-surface-2"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      )}

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
              onClick={() => control({ action: "reconcile" }, "reconcile")}
              disabled={!!busy}
              title="Reconcile the building queue against the repo (landed → shipped, stalled → blocked)"
              className="font-mono text-[12px] px-3 h-[32px] rounded-[8px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
            >
              {busy === "reconcile" ? "Reconciling…" : "Reconcile"}
            </button>
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

      {/* Treasury & fees — read-only diagnostic for the selected project (chain +
          fee_ledger + agent_actions). No money moves; informs claim/sweep decisions. */}
      <TreasuryPanel activeKey={activeKey} />

      {/* Provisioning checklist — green/red infra bricks for the selected project,
          with provision/retry on the missing ones (infra only, no funds). */}
      <ProvisioningPanel activeKey={activeKey} />

      {/* Runtime config — per-project operator knobs (override the platform env). */}
      <ConfigPanel activeKey={activeKey} />

      {/* Waiting on founder — the typed agent→founder request queue */}
      {snap.escalations.length > 0 && (
        <Panel title={`Waiting on you · ${snap.escalations.length}`} accent>
          <div className="flex flex-col gap-2">
            {snap.escalations.map((e) => (
              <EscalationItem key={e.id} esc={e} busy={busy} control={control} />
            ))}
          </div>
        </Panel>
      )}

      {/* Building now */}
      {snap.building.length > 0 && (
        <Panel title={`Building now · ${snap.building.length}`}>
          <TaskList rows={snap.building} kind="building" control={control} busy={busy} />
        </Panel>
      )}

      {/* Queue */}
      <Panel title={`Up next · ${snap.todo.length}`}>
        {snap.todo.length ? (
          <TaskList rows={snap.todo} kind="todo" control={control} busy={busy} />
        ) : (
          <Empty>Queue is empty.</Empty>
        )}
        <AddTask control={control} busy={busy} />
      </Panel>

      {/* Recently shipped */}
      <Panel title="Recently shipped">
        {snap.shipped.length ? <TaskList rows={snap.shipped} shipped /> : <Empty>Nothing shipped yet.</Empty>}
      </Panel>

      {/* Blocked */}
      {snap.blocked.length > 0 && (
        <Panel title={`Blocked · ${snap.blocked.length}`}>
          <TaskList rows={snap.blocked} kind="blocked" control={control} busy={busy} />
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

interface LiveProject {
  key: string;
  name: string;
  ticker: string;
}

function PrelaunchPanel() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [liveProjects, setLiveProjects] = useState<LiveProject[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `${wallet}:${action}`
  const [pf, setPf] = useState<Record<string, { ready: boolean; checks: Check[] }>>({});
  const [fund, setFund] = useState<Record<string, Funding>>({});
  const [result, setResult] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/prelaunch", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "load failed");
      setDrafts(j.drafts);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
    // The "Launched" footer should reflect every REAL project (the projects
    // table), not just the subset that happens to still have a launch_waitlist
    // row pointed at them — a detached/reset draft (or a project that never
    // went through the public waitlist at all, like LOOP itself) would
    // otherwise silently drop out of the count despite being fully live.
    try {
      const r = await fetch("/api/admin/projects", { cache: "no-store" });
      const j = await r.json();
      if (r.ok) setLiveProjects(j.projects ?? []);
    } catch {
      /* best-effort — the footer just stays empty on failure */
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

  async function provisionHome(wallet: string) {
    setBusy(`${wallet}:provision-home`);
    setErr(null);
    try {
      const r = await fetch("/api/admin/prelaunch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, action: "provision-home" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "provisioning failed");
      setResult((m) => ({ ...m, [wallet]: j.home?.note ?? (j.ok ? "Home provisioned" : "Provisioning failed") }));
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "provisioning failed");
    } finally {
      setBusy(null);
    }
  }

  async function editDraft(wallet: string, fields: DraftFields) {
    setBusy(`${wallet}:edit`);
    setErr(null);
    try {
      const r = await fetch("/api/admin/prelaunch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, action: "edit", fields }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "edit failed");
      setResult((m) => ({ ...m, [wallet]: "Saved ✓" }));
      setEditing(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "edit failed");
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
          [wallet]: `Launched → ${j.key}${j.mint ? ` · ${j.mint.slice(0, 4)}…${j.mint.slice(-4)}` : ""}${j.simulated ? " (simulated)" : ""}${j.provisioning ? ` · ${j.provisioning}` : ""}${j.feeSharing ? ` · fee-sharing: ${j.feeSharing}` : ""}${j.backers ? ` · backers: ${j.backers}` : ""}`,
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

  // A launched draft has already become a real project (in the Projects panel) —
  // keep it out of the actionable pre-launch list (the Buildtopia duplicate). The
  // "Launched" footer itself is sourced from liveProjects (the real projects
  // table), not this filter — a draft can be detached/reset (or a project like
  // LOOP never had a draft at all) without dropping out of that count.
  const activeDrafts = (drafts ?? []).filter((d) => d.status !== "launched");
  const n = activeDrafts.length;
  return (
    <Panel title={`Pre-launch · ${n}`} accent>
      {err && <div className="text-[12px] text-neg font-mono mb-2">{err}</div>}
      {drafts == null ? (
        <Empty>Loading…</Empty>
      ) : activeDrafts.length === 0 && (liveProjects?.length ?? 0) === 0 ? (
        <Empty>No drafts yet.</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {(["solana", "hood"] as const).map((groupChain) => {
            // Drafts are separated by target chain (Solana / Hood) so curation of
            // each launch surface is unambiguous. Pre-`chain`-migration rows
            // default to solana.
            const group = activeDrafts.filter((d) => (d.chain ?? "solana") === groupChain);
            if (!group.length) return null;
            return (
              <div key={groupChain} className="flex flex-col gap-2">
                <div className="text-[11px] font-mono uppercase tracking-wide text-faint">
                  {groupChain === "hood" ? "Hood · Robinhood Chain" : "Solana"} · {group.length}
                </div>
                <div className="flex flex-col gap-3">
          {group.map((d) => {
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
                  {d.chain === "hood" && (
                    <span className="font-mono text-[10px] px-2 py-[2px] rounded-full border border-accent-300 text-accent-text">Hood</span>
                  )}
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

                {d.status !== "draft" && (
                  <div className="mt-2 text-[11.5px] font-mono flex items-center gap-2 flex-wrap">
                    <span className="text-faint">home</span>
                    {d.homeVercelUrl ? (
                      <>
                        <a href={d.homeVercelUrl} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
                          {d.homeVercelUrl.replace(/^https?:\/\//, "")}
                        </a>
                        <span className="text-faint">·</span>
                        <a
                          href={`https://github.com/${d.homeRepo}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-body hover:underline"
                        >
                          {d.homeRepo}
                        </a>
                      </>
                    ) : (
                      <span className="text-faint">not provisioned</span>
                    )}
                    <Btn onClick={() => provisionHome(d.wallet)} busy={isBusy("provision-home")}>
                      {d.homeVercelUrl ? "Re-provision" : "Provision home"}
                    </Btn>
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

                {editing === d.wallet && (
                  <DraftEditForm
                    draft={d}
                    busy={isBusy("edit")}
                    onCancel={() => setEditing(null)}
                    onSave={(fields) => editDraft(d.wallet, fields)}
                  />
                )}

                {!launched ? (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Btn onClick={() => setEditing(editing === d.wallet ? null : d.wallet)} busy={false}>
                      {editing === d.wallet ? "Close edit" : "Edit"}
                    </Btn>
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
              </div>
            );
          })}
          {liveProjects && liveProjects.length > 0 && (
            <div className="border-t border-line-3 pt-2 mt-1">
              <div className="text-[11px] font-mono text-faint mb-1">Launched · {liveProjects.length}</div>
              <div className="flex flex-col gap-1">
                {liveProjects.map((p) => (
                  <a
                    key={p.key}
                    href={`/token?p=${p.key}`}
                    className="font-mono text-[12px] flex items-center gap-2 flex-wrap hover:underline"
                  >
                    <span className="text-pos">✓</span>
                    <span className="text-body">{p.name}</span>
                    <span className="text-accent-text">{cashtag(p.ticker)}</span>
                    <span className="text-faint">→ {p.key}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Small labeled inputs, styled to match the console tokens ──────────────────
function LInput({
  label,
  value,
  onChange,
  placeholder,
  mono,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.02em] text-faint">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`bg-surface-2 border border-line-3 rounded-[8px] px-2.5 h-[32px] text-[12.5px] text-ink outline-none focus:border-accent/60 transition-colors ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}

function LArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.02em] text-faint">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="bg-surface-2 border border-line-3 rounded-[8px] px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-accent/60 transition-colors resize-y leading-[1.4]"
      />
    </label>
  );
}

// ── Edit a pre-launch draft (admin, any draft — name/ticker/prompt/repo/fee) ──
function DraftEditForm({
  draft,
  busy,
  onCancel,
  onSave,
}: {
  draft: Draft;
  busy: boolean;
  onCancel: () => void;
  onSave: (fields: DraftFields) => void;
}) {
  const [name, setName] = useState(draft.name ?? "");
  const [ticker, setTicker] = useState(draft.ticker ?? "");
  const [prompt, setPrompt] = useState(draft.prompt ?? "");
  const [repo, setRepo] = useState(draft.repo ?? "");
  const [fee, setFee] = useState(draft.feeFounderPct == null ? "" : String(draft.feeFounderPct));

  function save() {
    const fields: DraftFields = {
      name: name.trim(),
      ticker: ticker.trim(),
      prompt,
      repo,
    };
    const f = Number(fee);
    if (fee.trim() !== "" && Number.isFinite(f)) fields.feeFounderPct = f;
    onSave(fields);
  }

  return (
    <div className="mt-2 border border-line-3 rounded-[10px] p-3 bg-surface-2/40 flex flex-col gap-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <LInput label="Name" value={name} onChange={setName} />
        <LInput label="Ticker" value={ticker} onChange={(v) => setTicker(v.toUpperCase())} mono />
      </div>
      <LArea label="Prompt / mandate" value={prompt} onChange={setPrompt} rows={3} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <LInput label="Repo (github URL)" value={repo} onChange={setRepo} mono placeholder="https://github.com/…" />
        <LInput label="Founder fee %" value={fee} onChange={setFee} type="number" mono placeholder="30" />
      </div>
      <div className="text-[11px] text-faint font-mono">
        split → {splitOf(fee.trim() !== "" && Number.isFinite(Number(fee)) ? Number(fee) : draft.feeFounderPct)} (founder/agent/platform)
      </div>
      <div className="flex items-center gap-2">
        <Btn onClick={save} busy={busy} danger={false}>Save</Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

// ── Platform-admin control over EVERY launched project ────────────────────────
function ProjectsPanel() {
  const [projects, setProjects] = useState<AdminProject[] | null>(null);
  const [secretsArmed, setSecretsArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `${key}:${action}`
  const [editing, setEditing] = useState<string | null>(null);
  const [keying, setKeying] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/projects", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "load failed");
      setProjects(j.projects);
      setSecretsArmed(Boolean(j.secretsArmed));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function post(key: string, body: Record<string, unknown>, tag: string, okMsg?: string) {
    setBusy(`${key}:${tag}`);
    setErr(null);
    try {
      const r = await fetch("/api/admin/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, ...body }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${tag} failed`);
      if (okMsg) setResult((m) => ({ ...m, [key]: okMsg }));
      await load();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${tag} failed`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const n = projects?.length ?? 0;
  return (
    <Panel title={`Projects · ${n}`}>
      {err && <div className="text-[12px] text-neg font-mono mb-2">{err}</div>}
      {projects == null ? (
        <Empty>Loading…</Empty>
      ) : n === 0 ? (
        <Empty>No launched projects yet.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((p) => {
            const isBusy = (a: string) => busy === `${p.key}:${a}`;
            return (
              <div key={p.key} className="border border-line-3 rounded-[10px] p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {p.tokenImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    // `cover` holds a THEME key ("neon"/"loop"), not a URL — the real
                    // logo lives in tokenImageUrl. onError hides a 404 so we never show
                    // a broken-image icon (mirrors LiveProjects).
                    <img
                      src={p.tokenImageUrl}
                      alt=""
                      className="w-7 h-7 rounded-full object-cover border border-line-3"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                  <span className="font-display font-semibold text-[14px]">{p.name}</span>
                  <span className="font-mono text-[12px] text-accent-text">{cashtag(p.ticker)}</span>
                  {p.official && (
                    <span className="font-mono text-[10px] px-2 py-[2px] rounded-full bg-accent text-white">official</span>
                  )}
                  <span className="font-mono text-[10px] px-2 py-[2px] rounded-full bg-surface-2 text-muted">
                    {p.network ?? "—"}
                  </span>
                  <span
                    className={`font-mono text-[10px] px-2 py-[2px] rounded-full ${
                      p.agentPaused ? "bg-neg/10 text-neg" : "bg-pos/10 text-pos"
                    }`}
                  >
                    {p.agentPaused ? "paused" : "live"}
                  </span>
                  <a
                    href={`/token?p=${p.key}`}
                    className="font-mono text-[11px] text-faint ml-auto hover:text-accent-text hover:underline"
                  >
                    {p.key} →
                  </a>
                </div>

                <div className="text-[11.5px] text-faint font-mono mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>split {p.splitLabel}</span>
                  {p.mint && <span>mint {shortAddr(p.mint)}</span>}
                  {p.treasurySol != null && <span>treasury {p.treasurySol.toFixed(3)} SOL</span>}
                  <span className={p.hasAgentKey ? "text-pos" : "text-faint"}>
                    {p.hasAgentKey ? "BYO key ✓" : "default key"}
                  </span>
                </div>
                {p.description && <div className="text-[12px] text-muted mt-1">{p.description}</div>}

                {result[p.key] && <div className="text-[12px] text-pos font-mono mt-2">{result[p.key]}</div>}

                {editing === p.key && (
                  <ProjectEditForm
                    project={p}
                    busy={isBusy("edit")}
                    onCancel={() => setEditing(null)}
                    onSave={async (fields) => {
                      const ok = await post(p.key, { action: "edit", fields }, "edit", "Saved ✓");
                      if (ok) setEditing(null);
                    }}
                  />
                )}

                {keying === p.key && (
                  <KeyForm
                    armed={secretsArmed}
                    hasKey={p.hasAgentKey}
                    busy={isBusy("set-key")}
                    onCancel={() => setKeying(null)}
                    onSave={async (anthropicKey) => {
                      const ok = await post(p.key, { action: "set-key", anthropicKey }, "set-key", "Agent key stored ✓");
                      if (ok) setKeying(null);
                    }}
                  />
                )}

                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Btn onClick={() => setEditing(editing === p.key ? null : p.key)}>
                    {editing === p.key ? "Close edit" : "Edit"}
                  </Btn>
                  <Btn onClick={() => setKeying(keying === p.key ? null : p.key)}>
                    {keying === p.key ? "Close key" : p.hasAgentKey ? "Replace API key" : "Set API key"}
                  </Btn>
                  {p.agentPaused ? (
                    <Btn onClick={() => post(p.key, { action: "resume" }, "resume", "Resumed ✓")} busy={isBusy("resume")}>
                      Resume agent
                    </Btn>
                  ) : (
                    <Btn onClick={() => post(p.key, { action: "pause" }, "pause", "Paused ✓")} busy={isBusy("pause")}>
                      Pause agent
                    </Btn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ── Edit a launched project's mutable fields (admin, any project) ─────────────
function ProjectEditForm({
  project,
  busy,
  onCancel,
  onSave,
}: {
  project: AdminProject;
  busy: boolean;
  onCancel: () => void;
  onSave: (fields: ProjectFields) => void;
}) {
  const [name, setName] = useState(project.name ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [prompt, setPrompt] = useState(project.prompt ?? "");
  const [repo, setRepo] = useState(project.repo ?? "");
  const [cover, setCover] = useState(project.cover ?? "");
  const [guardrails, setGuardrails] = useState(project.guardrails ?? "");
  const [contentPolicy, setContentPolicy] = useState(project.contentPolicy ?? "");
  const [twitter, setTwitter] = useState(project.twitter ?? "");
  const [telegram, setTelegram] = useState(project.telegram ?? "");
  const [discord, setDiscord] = useState(project.discord ?? "");
  const [website, setWebsite] = useState(project.website ?? "");
  const [fee, setFee] = useState(project.feeFounderPct == null ? "" : String(project.feeFounderPct));

  function save() {
    const fields: ProjectFields = {
      name: name.trim(),
      description,
      prompt,
      repo,
      cover,
      guardrails,
      contentPolicy,
      twitter,
      telegram,
      discord,
      website,
    };
    const f = Number(fee);
    if (fee.trim() !== "" && Number.isFinite(f)) fields.feeFounderPct = f;
    onSave(fields);
  }

  return (
    <div className="mt-2 border border-line-3 rounded-[10px] p-3 bg-surface-2/40 flex flex-col gap-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <LInput label="Name" value={name} onChange={setName} />
        <LInput label="Founder fee %" value={fee} onChange={setFee} type="number" mono placeholder="30" />
      </div>
      <LArea label="Description" value={description} onChange={setDescription} rows={2} />
      <LArea label="Prompt / mandate" value={prompt} onChange={setPrompt} rows={3} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <LInput label="Repo (github URL)" value={repo} onChange={setRepo} mono placeholder="https://github.com/…" />
        <LInput label="Cover (image URL)" value={cover} onChange={setCover} mono />
      </div>
      <LArea label="Guardrails" value={guardrails} onChange={setGuardrails} rows={2} />
      <LArea label="Content policy" value={contentPolicy} onChange={setContentPolicy} rows={2} />

      {/* Brand images — uploaded immediately to the public bucket + persisted. */}
      <div className="grid grid-cols-[60px_1fr] gap-2.5 items-end">
        <ImageUpload projectKey={project.key} kind="token" current={project.tokenImageUrl} circle />
        <ImageUpload projectKey={project.key} kind="banner" current={project.bannerUrl} />
      </div>

      {/* Social links — handle or full URL; saved with the form, normalized server-side. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <LInput label="X / Twitter" value={twitter} onChange={setTwitter} mono placeholder="@handle or x.com/…" />
        <LInput label="Telegram" value={telegram} onChange={setTelegram} mono placeholder="@name or t.me/…" />
        <LInput label="Discord" value={discord} onChange={setDiscord} mono placeholder="discord.gg/…" />
        <LInput label="Website" value={website} onChange={setWebsite} mono placeholder="https://…" />
      </div>

      <div className="text-[11px] text-faint font-mono">
        split → {splitOf(fee.trim() !== "" && Number.isFinite(Number(fee)) ? Number(fee) : project.feeFounderPct)} (founder/agent/platform)
      </div>

      {/* Custom domain — same widget the creator uses on /token. */}
      <div className="border-t border-line-3 pt-2.5">
        <ProjectDomainManager projectKey={project.key} currentDomain={project.domain} />
      </div>

      <div className="flex items-center gap-2">
        <Btn onClick={save} busy={busy}>Save</Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

// ── Upload a project's logo/banner (immediate, founder-gated) ─────────────────
function ImageUpload({
  projectKey,
  kind,
  current,
  circle,
}: {
  projectKey: string;
  kind: "token" | "banner";
  current: string | null;
  circle?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File | null) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("key", projectKey);
      fd.append("kind", kind);
      fd.append("file", file);
      const r = await fetch("/api/admin/projects/media", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "upload failed");
      setUrl(j.url as string);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="block text-[12.5px] text-muted">{kind === "token" ? "Token logo" : "Banner"}</label>
      <label
        className={`relative flex items-center justify-center overflow-hidden border border-dashed border-line-3 bg-surface-2 cursor-pointer hover:border-line-hover transition-colors ${
          circle ? "h-[60px] w-[60px] rounded-full" : "h-[60px] w-full rounded-[10px]"
        }`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[11px] text-faint">{busy ? "…" : "+ image"}</span>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label={`Upload ${kind} image`}
        />
      </label>
      {err && <span className="text-[11px] text-neg">{err}</span>}
    </div>
  );
}

// ── Set a project's BYO Anthropic key (write-only; stored encrypted) ──────────
function KeyForm({
  armed,
  hasKey,
  busy,
  onCancel,
  onSave,
}: {
  armed: boolean;
  hasKey: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (key: string) => void;
}) {
  const [k, setK] = useState("");
  return (
    <div className="mt-2 border border-line-3 rounded-[10px] p-3 bg-surface-2/40 flex flex-col gap-2.5">
      {!armed ? (
        <div className="text-[12px] text-neg font-mono">
          Per-project key store is off — set PROJECT_SECRETS_KEY (32-byte master key) to enable BYO keys.
        </div>
      ) : (
        <>
          <LInput
            label={hasKey ? "Replace Anthropic key (sk-ant-…)" : "Anthropic key (sk-ant-…)"}
            value={k}
            onChange={setK}
            mono
            type="password"
            placeholder="sk-ant-…"
          />
          <div className="text-[11px] text-faint font-mono">
            Encrypted at rest (AES-256-GCM) · write-only · billed to this project, not Loop.
          </div>
          <div className="flex items-center gap-2">
            <Btn onClick={() => onSave(k)} busy={busy}>Store key</Btn>
            <Btn onClick={onCancel}>Cancel</Btn>
          </div>
        </>
      )}
      {!armed && (
        <div className="flex">
          <Btn onClick={onCancel}>Close</Btn>
        </div>
      )}
    </div>
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

function TaskBtn({
  onClick,
  busy,
  danger,
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`font-mono text-[10.5px] px-2 h-[26px] rounded-[6px] flex-none disabled:opacity-50 ${
        danger
          ? "border border-line-2 text-neg hover:bg-neg/5"
          : "border border-line-2 hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

// Shared task list. With `kind` + `control` it becomes the actionable stuck-task /
// backlog surface: building/blocked rows can be marked shipped or requeued (the
// reconcile-by-hand for a leaked "building" task), todo rows can be promoted to the
// top of the queue ("build next") or removed. `shipped` stays read-only.
function TaskList({
  rows,
  shipped,
  kind,
  control,
  busy,
}: {
  rows: AdminTaskRow[];
  shipped?: boolean;
  kind?: "building" | "todo" | "blocked";
  control?: (body: Record<string, unknown>, tag: string) => void;
  busy?: string | null;
}) {
  const act = (id: number, body: Record<string, unknown>) =>
    control?.({ ...body, taskId: id }, `task-${id}`);
  return (
    <div className="flex flex-col">
      {rows.map((r) => {
        const rowBusy = busy === `task-${r.id}`;
        return (
          <div key={r.id} className="flex items-start gap-3 py-2 border-b border-line-4 last:border-0">
            <span
              className={`font-mono text-[10px] px-[6px] py-[2px] rounded-[5px] flex-none mt-[1px] ${
                shipped ? "bg-pos/10 text-pos" : "bg-surface-2 text-muted"
              }`}
            >
              {r.category}
            </span>
            <span className="text-[12.5px] text-ink leading-[1.4] flex-1 min-w-0">{r.title}</span>
            {kind === "todo" && (
              <span className="font-mono text-[10px] text-faint flex-none mt-[3px] whitespace-nowrap">
                {r.source !== "agent" ? `${r.source} ` : ""}p{r.priority}
              </span>
            )}
            {control && kind && (
              <div className="flex gap-1 flex-none">
                {(kind === "building" || kind === "blocked") && (
                  <>
                    <TaskBtn onClick={() => act(r.id, { action: "task-status", status: "shipped" })} busy={rowBusy}>
                      ✓ shipped
                    </TaskBtn>
                    <TaskBtn onClick={() => act(r.id, { action: "task-status", status: "todo" })} busy={rowBusy}>
                      ↩ requeue
                    </TaskBtn>
                  </>
                )}
                {kind === "todo" && (
                  <TaskBtn
                    onClick={() => act(r.id, { action: "task-priority", priority: 120, source: "founder" })}
                    busy={rowBusy}
                  >
                    ↑ build next
                  </TaskBtn>
                )}
                <TaskBtn onClick={() => act(r.id, { action: "task-remove" })} busy={rowBusy} danger>
                  ✕
                </TaskBtn>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Founder adds a top-priority backlog task straight from the admin — also the way
// to re-arm a project under the compute-saver (a founder/priority task clears the
// build floor, so the agent builds it next instead of deferring band-0 busywork).
function AddTask({
  control,
  busy,
}: {
  control: (body: Record<string, unknown>, tag: string) => void;
  busy: string | null;
}) {
  const [title, setTitle] = useState("");
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    control({ action: "task-add", title: t }, "task-add");
    setTitle("");
  };
  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="Add a top-priority task…"
        className="flex-1 min-w-0 font-mono text-[12px] px-2 h-[30px] rounded-[7px] border border-line-2 bg-surface-2 outline-none focus:border-accent/50"
      />
      <button
        onClick={submit}
        disabled={!!busy || !title.trim()}
        className="font-mono text-[12px] px-3 h-[30px] rounded-[7px] bg-accent text-white hover:opacity-90 disabled:opacity-50 flex-none"
      >
        {busy === "task-add" ? "…" : "Add"}
      </button>
    </div>
  );
}

// Read-only treasury diagnostic for the selected project. Lifts
// scripts/diag-treasury.ts into the cockpit: on-chain treasury/agent balances,
// the fee_ledger (earned/claimed/claimable per role), and agent_actions totals.
// Polls nothing — fetches on mount + when the project switches, plus a manual
// refresh (chain reads are a touch slow, so we don't auto-poll this).
// One typed agent→founder request. The resolution controls depend on its kind:
//   decision   → Approve / Decline (the legacy out-of-mandate sign-off)
//   action     → Done (the founder did the manual step)
//   info       → free-text answer the agent reads next tick → Send
//   credential → Mark provided (the secret goes via "Set API key", never stored here)
function EscalationItem({
  esc,
  busy,
  control,
}: {
  esc: AdminSnapshot["escalations"][number];
  busy: string | null;
  control: (body: Record<string, unknown>, tag: string) => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const tag = `esc-${esc.id}`;
  const resolve = (decision: string, response?: string) =>
    control({ action: "escalation", id: esc.id, kind: esc.kind, decision, response }, tag);

  const badge = (
    <span className="font-mono text-[10px] px-1.5 py-[2px] rounded-[5px] bg-surface-2 text-muted uppercase tracking-[0.03em]">
      {esc.kind}
    </span>
  );

  return (
    <div className="border border-line-4 rounded-[10px] px-3 py-2 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {badge}
          <span className="text-[12.5px] text-ink leading-[1.4]">{esc.body}</span>
        </div>
        <div className="flex gap-1 flex-none">
          {esc.kind === "decision" ? (
            <>
              <button
                onClick={() => resolve("adopted")}
                disabled={!!busy}
                className="font-mono text-[11px] px-2 h-[28px] rounded-[7px] bg-accent text-white hover:opacity-90 disabled:opacity-60"
              >
                Approve
              </button>
              <button
                onClick={() => resolve("declined")}
                disabled={!!busy}
                className="font-mono text-[11px] px-2 h-[28px] rounded-[7px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
              >
                Decline
              </button>
            </>
          ) : esc.kind === "info" ? null : (
            <button
              onClick={() => resolve("done")}
              disabled={!!busy}
              className="font-mono text-[11px] px-2 h-[28px] rounded-[7px] bg-accent text-white hover:opacity-90 disabled:opacity-60"
              title={
                esc.kind === "credential"
                  ? "Mark provided — supply the secret via Set API key, not here"
                  : "Mark the manual step done"
              }
            >
              {esc.kind === "credential" ? "Mark provided" : "Done"}
            </button>
          )}
        </div>
      </div>
      {esc.kind === "info" && (
        <div className="flex gap-2">
          <input
            value={answer}
            onChange={(ev) => setAnswer(ev.target.value)}
            placeholder="Answer (the agent reads this next tick)…"
            className="flex-1 font-mono text-[12px] px-2 h-[30px] rounded-[8px] border border-line-2 bg-surface-2 outline-none focus:border-accent"
          />
          <button
            onClick={() => resolve("done", answer)}
            disabled={!!busy || !answer.trim()}
            className="font-mono text-[12px] px-3 h-[30px] rounded-[8px] bg-accent text-white hover:opacity-90 disabled:opacity-60"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

// Per-project runtime config (Lot 5). Each whitelisted knob shows its effective
// value (override, else the platform env default) with an inline override input
// and a Clear-to-default. Writes go through /api/admin/control (config-set/clear).
function ConfigPanel({ activeKey }: { activeKey: string }) {
  const [knobs, setKnobs] = useState<KnobView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/config?p=${activeKey}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "failed to load");
        setKnobs(null);
        return;
      }
      setKnobs(j.knobs as KnobView[]);
      setDraft({});
    } catch {
      setErr("network error");
    } finally {
      setLoading(false);
    }
  }, [activeKey]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: string, knob: string, value?: string) => {
    setBusy(knob);
    setErr(null);
    try {
      const r = await fetch("/api/admin/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: activeKey, action, kind: knob, response: value }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "config failed");
      await load();
    } catch {
      setErr("network error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-display font-semibold text-[14px]">
          Runtime config{" "}
          <span className="text-faint font-mono text-[11px]">· {activeKey} · overrides the platform env</span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="font-mono text-[12px] px-3 h-[28px] rounded-[8px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {err ? (
        <Empty>{err}</Empty>
      ) : !knobs ? (
        <Empty>{loading ? "Loading…" : "No data."}</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {knobs.map((k) => (
            <div key={k.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <span className="font-mono text-[12.5px] text-ink">{k.label}</span>
                  <span className="font-mono text-[10.5px] text-faint ml-2">{k.key}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted">
                    now: <span className="text-ink">{k.effective || "(default)"}</span>
                    {k.override == null && <span className="text-faint"> · env default</span>}
                  </span>
                  <input
                    value={draft[k.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [k.key]: e.target.value }))}
                    placeholder="override…"
                    className="w-[110px] font-mono text-[12px] px-2 h-[28px] rounded-[7px] border border-line-2 bg-surface-2 outline-none focus:border-accent"
                  />
                  <button
                    onClick={() => act("config-set", k.key, draft[k.key])}
                    disabled={busy === k.key || !(draft[k.key] ?? "").trim()}
                    className="font-mono text-[11px] px-2 h-[28px] rounded-[7px] bg-accent text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {busy === k.key ? "…" : "Set"}
                  </button>
                  {k.override != null && (
                    <button
                      onClick={() => act("config-clear", k.key)}
                      disabled={busy === k.key}
                      className="font-mono text-[11px] px-2 h-[28px] rounded-[7px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <div className="font-mono text-[10.5px] text-faint">{k.hint}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Per-project provisioning checklist (Lot 4). Self-fetches green/red infra bricks
// and offers provision/retry on the missing ones (repo+Vercel home, agent wallet).
// Infra only — no funds. Auto-refreshes after a retry.
function ProvisioningPanel({ activeKey }: { activeKey: string }) {
  const [data, setData] = useState<ProvisioningChecklist | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/provisioning?p=${activeKey}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "failed to load");
        setData(null);
        return;
      }
      setData(j as ProvisioningChecklist);
    } catch {
      setErr("network error");
    } finally {
      setLoading(false);
    }
  }, [activeKey]);

  useEffect(() => {
    load();
    setNote(null);
  }, [load]);

  const retry = async (action: string, brickKey: string) => {
    setBusy(brickKey);
    setNote(null);
    setErr(null);
    try {
      const r = await fetch("/api/admin/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: activeKey, action }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error || "provision failed");
      else setNote(j.note || j.address || "done");
      await load();
    } catch {
      setErr("network error");
    } finally {
      setBusy(null);
    }
  };

  const dot = (s: string) =>
    s === "ok" ? "bg-pos" : s === "missing" ? "bg-neg" : "bg-faint";

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-display font-semibold text-[14px]">
          Provisioning{" "}
          <span className="text-faint font-mono text-[11px]">
            · {activeKey}
            {data ? (data.ready ? " · ready" : " · incomplete") : ""}
          </span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="font-mono text-[12px] px-3 h-[28px] rounded-[8px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {err ? (
        <Empty>{err}</Empty>
      ) : !data ? (
        <Empty>{loading ? "Checking…" : "No data."}</Empty>
      ) : (
        <div className="flex flex-col gap-1.5">
          {data.bricks.map((b) => (
            <div key={b.key} className="flex items-center justify-between gap-3 py-[3px]">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-[8px] h-[8px] rounded-full flex-none ${dot(b.status)}`} />
                <span className="font-mono text-[12.5px] text-ink flex-none">{b.label}</span>
                <span className="font-mono text-[11px] text-faint truncate">{b.detail}</span>
              </div>
              {b.action && b.status === "missing" && (
                <button
                  onClick={() => retry(b.action!, b.key)}
                  disabled={!!busy}
                  className="font-mono text-[11px] px-2 h-[26px] rounded-[7px] border border-line-2 hover:bg-surface-2 disabled:opacity-60 flex-none"
                >
                  {busy === b.key ? "…" : "Provision"}
                </button>
              )}
            </div>
          ))}
          {note && <div className="text-[12px] text-pos font-mono mt-1 break-all">{note}</div>}
        </div>
      )}
    </div>
  );
}

interface MoveState {
  op: "treasury-sweep" | "treasury-claim" | "treasury-distribute";
  label: string;
  preview: Record<string, unknown>;
}

// Renders the fee-distribution preview: the per-role transfers that WOULD be
// sent (bounded to the ledger's claimable) + anything held back, before confirm.
function DistributePreview({ preview }: { preview: Record<string, unknown> }) {
  const transfers = (preview.transfers as { role: string; to: string; sol: number }[]) ?? [];
  const skipped = (preview.skipped as string[]) ?? [];
  const claimable = preview.claimable as
    | { founderSol: number; agentSol: number; platformSol: number }
    | undefined;
  return (
    <div className="font-mono text-[11px] text-muted leading-[1.6] flex flex-col gap-1">
      {claimable && (
        <div className="text-faint">
          claimable — founder {claimable.founderSol.toFixed(4)} · agent {claimable.agentSol.toFixed(4)} · platform{" "}
          {claimable.platformSol.toFixed(4)}
        </div>
      )}
      {transfers.length ? (
        transfers.map((t, i) => (
          <div key={i} className="text-ink">
            → {t.role} {t.sol.toFixed(4)} SOL → {t.to.slice(0, 8)}…{t.to.slice(-4)}
          </div>
        ))
      ) : (
        <div>Nothing to distribute right now.</div>
      )}
      {skipped.map((s, i) => (
        <div key={`s${i}`} className="text-faint">
          · {s}
        </div>
      ))}
    </div>
  );
}

function TreasuryPanel({ activeKey }: { activeKey: string }) {
  const [diag, setDiag] = useState<TreasuryDiag | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Two-phase money-move: stage a preview, then confirm to sign + send.
  const [move, setMove] = useState<MoveState | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveResult, setMoveResult] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const postControl = useCallback(
    async (op: MoveState["op"], confirm: boolean) => {
      const r = await fetch("/api/admin/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: activeKey, action: op, confirm }),
      });
      return { ok: r.ok, body: await r.json() };
    },
    [activeKey]
  );

  // Phase 1: fetch the preview and stage the confirm bar.
  const stage = useCallback(
    async (op: MoveState["op"], label: string) => {
      setErr(null);
      setMoveResult(null);
      setMoveBusy(true);
      try {
        const { ok, body } = await postControl(op, false);
        if (!ok) {
          setErr(body.error || "preview failed");
          return;
        }
        setMove({ op, label, preview: body.preview ?? {} });
      } catch {
        setErr("network error");
      } finally {
        setMoveBusy(false);
      }
    },
    [postControl]
  );

  // Phase 2: confirm — sign + send, then refresh the diagnostic.
  const confirmMove = useCallback(async () => {
    if (!move) return;
    setMoveBusy(true);
    setErr(null);
    try {
      const { ok, body } = await postControl(move.op, true);
      if (!ok) {
        setErr(body.error || "action failed");
        return;
      }
      const sig = body.txSig as string | undefined;
      const claimed = body.claimedSol as number | undefined;
      const note = body.note as string | undefined;
      setMoveResult(
        sig
          ? `✓ ${move.label} sent${claimed != null ? ` · ${claimed.toFixed(4)} SOL` : ""} · ${sig.slice(0, 12)}…`
          : note
            ? `✓ ${move.label} · ${note}`
            : `✓ ${move.label} done`
      );
      setMove(null);
      setRefreshTick((t) => t + 1); // re-read balances after the move lands
    } catch {
      setErr("network error");
    } finally {
      setMoveBusy(false);
    }
  }, [move, postControl]);

  const fetchDiag = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/treasury?p=${activeKey}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error || "failed to load");
        setDiag(null);
        return;
      }
      setDiag(j as TreasuryDiag);
    } catch {
      setErr("network error");
    } finally {
      setLoading(false);
    }
  }, [activeKey, refreshTick]);

  useEffect(() => {
    fetchDiag();
  }, [fetchDiag]);

  // Clear any staged move when switching projects (its preview is project-bound).
  useEffect(() => {
    setMove(null);
    setMoveResult(null);
  }, [activeKey]);

  const sol = (n: number | null | undefined) =>
    n == null ? "—" : `${n.toFixed(4)} SOL`;
  const tok = (n: number | null | undefined) =>
    n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-display font-semibold text-[14px]">
          Treasury &amp; fees{" "}
          <span className="text-faint font-mono text-[11px]">· {activeKey} · read-only</span>
        </div>
        <button
          onClick={fetchDiag}
          disabled={loading}
          className="font-mono text-[12px] px-3 h-[28px] rounded-[8px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {err ? (
        <Empty>{err}</Empty>
      ) : !diag ? (
        <Empty>{loading ? "Reading chain…" : "No data."}</Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {/* On-chain balances */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Treasury SOL" value={sol(diag.treasury.sol)} />
            <Stat label="Treasury token" value={tok(diag.treasury.token)} />
            <Stat label="Agent SOL" value={sol(diag.agent.sol)} />
            <Stat label="Agent token" value={tok(diag.agent.token)} />
          </div>

          {/* Fee ledger — claimable is the actionable number (what a claim would pay each role) */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.02em] text-faint mb-2">
              Fee ledger — earned / claimed → claimable
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(["founder", "agent", "platform"] as const).map((role) => {
                const e = diag.ledger.earned[`${role}Sol`];
                const c = diag.ledger.claimed[`${role}Sol`];
                const cl = diag.ledger.claimable[`${role}Sol`];
                return (
                  <div key={role} className="border border-line-4 rounded-[10px] px-3 py-2">
                    <div className="text-[11px] font-mono text-muted capitalize">{role}</div>
                    <div className="font-mono text-[13px] text-ink mt-[2px]">{cl.toFixed(4)}</div>
                    <div className="text-[10px] text-faint font-mono mt-[2px]">
                      {e.toFixed(3)} earned · {c.toFixed(3)} claimed
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Buyback + agent_actions totals */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Stat
              label="Buyback executed"
              value={`${diag.buybackExecutedSol.toFixed(4)} SOL · ${diag.buybackTxCount} tx`}
            />
            <Stat label="Network" value={diag.network} />
            <Stat
              label="Snapshot"
              value={sol(diag.treasurySnapshotSol)}
            />
          </div>

          {/* Compute (Claude $) — the agent's other budget, alongside the SOL
              treasury above. Gate is the per-project COMPUTE_BUDGET_GATE knob. */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.02em] text-faint mb-2">
              Compute (Claude $){" "}
              <span className="text-faint">
                · {diag.compute.gateArmed ? "hard-capped" : "soft (gate off — informational only)"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Credited" value={`$${diag.compute.creditedUsd.toFixed(2)}`} />
              <Stat label="Consumed" value={`$${diag.compute.consumedUsd.toFixed(2)}`} />
              <Stat label="Balance" value={`$${diag.compute.balanceUsd.toFixed(2)}`} />
            </div>
          </div>
          {diag.actions.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.02em] text-faint mb-2">
                Agent actions — kind/disposition
              </div>
              <div className="flex flex-wrap gap-2">
                {diag.actions.map((a) => (
                  <span
                    key={a.key}
                    className="font-mono text-[11px] px-2 py-[3px] rounded-[6px] bg-surface-2 text-muted"
                    title={`${a.sol.toFixed(4)} SOL`}
                  >
                    {a.key} · {a.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Money-moves — preview → confirm. Sweep is per-project; claim is the
              launch signer's pump.fun creator fees (signer-wide, mainnet-only). */}
          <div className="border-t border-line-4 pt-4">
            <div className="text-[10px] uppercase tracking-[0.02em] text-faint mb-2">
              Money moves — preview, then confirm
            </div>
            {move ? (
              <div className="border border-accent/50 rounded-[10px] px-3 py-3 flex flex-col gap-2">
                <div className="font-mono text-[12px] text-ink">
                  Confirm: <span className="font-semibold">{move.label}</span>
                </div>
                {move.op === "treasury-distribute" ? (
                  <DistributePreview preview={move.preview} />
                ) : (
                  <pre className="font-mono text-[11px] text-muted whitespace-pre-wrap leading-[1.5] m-0">
                    {Object.entries(move.preview)
                      .map(([k, v]) => `${k}: ${typeof v === "number" ? v : String(v)}`)
                      .join("\n")}
                  </pre>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={confirmMove}
                    disabled={moveBusy}
                    className="font-mono text-[12px] px-3 h-[30px] rounded-[8px] bg-accent text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {moveBusy
                      ? "Sending…"
                      : `Confirm ${move.op === "treasury-sweep" ? "sweep" : move.op === "treasury-claim" ? "claim" : "distribute"}`}
                  </button>
                  <button
                    onClick={() => setMove(null)}
                    disabled={moveBusy}
                    className="font-mono text-[12px] px-3 h-[30px] rounded-[8px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => stage("treasury-sweep", `Sweep ${activeKey} agent wallet → treasury`)}
                  disabled={moveBusy}
                  title="Drain the agent (Privy) wallet to the project treasury, leaving a rent+fee buffer"
                  className="font-mono text-[12px] px-3 h-[30px] rounded-[8px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
                >
                  {moveBusy ? "…" : "Sweep agent → treasury"}
                </button>
                <button
                  onClick={() => stage("treasury-claim", "Claim pump.fun creator fees (signer-wide)")}
                  disabled={moveBusy}
                  title="Collect accrued pump.fun creator fees for the launch signer (mainnet, all its tokens)"
                  className="font-mono text-[12px] px-3 h-[30px] rounded-[8px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
                >
                  {moveBusy ? "…" : "Claim creator fees"}
                </button>
                <button
                  onClick={() => stage("treasury-distribute", `Distribute ${activeKey} fee shares (agent + platform)`)}
                  disabled={moveBusy}
                  title="Send the accrued agent (65%) + platform (5%) fee shares from the treasury to their wallets (bounded to the ledger's claimable)"
                  className="font-mono text-[12px] px-3 h-[30px] rounded-[8px] border border-line-2 hover:bg-surface-2 disabled:opacity-60"
                >
                  {moveBusy ? "…" : "Distribute fee shares"}
                </button>
              </div>
            )}
            {moveResult && (
              <div className="text-[12px] text-pos font-mono mt-2">{moveResult}</div>
            )}
          </div>
        </div>
      )}
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
