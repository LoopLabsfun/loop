"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import type { PublicPrelaunch } from "@/lib/prelaunch-public";

// PRE-LAUNCH BOARD — the social FOMO layer. Curated projects opening soon, with
// their real on-chain backing ("vote with SOL"). One-click Back sends SOL to the
// project's Loop-custodial wallet (refundable until launch). Even empty, it teases
// "the factory is opening" and funnels to pre-launch.
export function PrelaunchBoard({
  prelaunches,
  onLaunch,
}: {
  prelaunches: PublicPrelaunch[];
  onLaunch: () => void;
}) {
  return (
    <section id="prelaunch" className="max-w-[1160px] mx-auto px-10 pt-10 pb-7">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="font-mono text-[12px] text-accent-text tracking-wide uppercase mb-1">
            🏭 The factory is opening
          </div>
          <h2 className="font-display font-bold text-[26px] tracking-[-0.02em] m-0">
            Pre-launching now
          </h2>
          <p className="text-[13.5px] text-muted mt-1 mb-0 max-w-[560px]">
            Curated projects about to get their token, treasury and AI agent. Back the
            ones you believe in — it&apos;s refundable until they launch.
          </p>
        </div>
        <button
          onClick={onLaunch}
          className="font-display font-semibold text-[14px] px-4 py-[10px] rounded-[11px] bg-accent text-white hover:bg-accent-d transition-colors whitespace-nowrap"
        >
          Pre-launch yours →
        </button>
      </div>

      {prelaunches.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-line-3 bg-surface-2 px-6 py-10 text-center">
          <div className="font-display font-semibold text-[16px] mb-1">
            The first batch is being curated
          </div>
          <p className="text-[13px] text-muted max-w-[440px] mx-auto mb-4">
            Draft your project — name it, set its token, tell the agent what to build.
            The best get first access when the doors open.
          </p>
          <button
            onClick={onLaunch}
            className="font-display font-semibold text-[14px] px-5 py-[11px] rounded-[11px] bg-accent text-white hover:bg-accent-d transition-colors"
          >
            Pre-launch your project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {prelaunches.map((p) => (
            <PrelaunchCard key={`${p.name}-${p.ticker}`} p={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function PrelaunchCard({ p }: { p: PublicPrelaunch }) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Live totals once a backing reconcile returns (otherwise the server snapshot).
  const [funded, setFunded] = useState<{ totalSol: number; backers: number } | null>(null);
  const totalSol = funded?.totalSol ?? p.totalSol;
  const backers = funded?.backers ?? p.backers;
  const href = `/token?p=${encodeURIComponent(p.slug)}`;

  async function back() {
    if (!p.projectWallet) return;
    if (!wallet.connected || !wallet.address) {
      wallet.connect();
      return;
    }
    const sol = Number(amount);
    if (!Number.isFinite(sol) || sol <= 0) {
      setErr("Enter an amount");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await wallet.sendSol(p.projectWallet, sol);
      setDone(true);
      // Fold the on-chain transfer into the ledger so the counter updates without
      // a founder running the admin sync. Best-effort — the funds are already on
      // chain regardless, and the founder's reconcile/refund tooling still works.
      try {
        const r = await fetch("/api/prelaunch/back", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: p.slug }),
        });
        if (r.ok) {
          const j = await r.json();
          if (typeof j.totalSol === "number") setFunded({ totalSol: j.totalSol, backers: j.backers });
        }
      } catch {
        /* reconcile is best-effort */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed — try again";
      setErr(/reject|denied|cancel/i.test(msg) ? "Cancelled" : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-line-2 bg-surface overflow-hidden flex flex-col">
      <Link href={href} className="block group">
        <div className="h-[88px] bg-surface-2 relative">
          {p.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.bannerUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-accent-tint" />
          )}
          {p.tokenImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.tokenImageUrl}
              alt=""
              className="absolute left-4 -bottom-5 w-11 h-11 rounded-full object-cover border-2 border-surface"
            />
          )}
        </div>
      </Link>

      <div className="px-4 pt-7 pb-4 flex flex-col gap-2 flex-1">
        <Link href={href} className="flex items-center gap-2 group">
          <span className="font-display font-semibold text-[15px] group-hover:text-accent-text transition-colors">
            {p.name}
          </span>
          <span className="font-mono text-[12px] text-accent-text">${p.ticker}</span>
          <span className="font-mono text-[9.5px] px-2 py-[2px] rounded-full bg-accent-tint text-accent-text ml-auto">
            opening soon
          </span>
        </Link>
        {p.pitch && <p className="text-[12.5px] text-muted leading-[1.5] line-clamp-2 m-0">{p.pitch}</p>}

        <div className="flex items-center gap-3 font-mono text-[12px] mt-1">
          <span className="text-pos font-semibold tabular-nums">{totalSol} SOL</span>
          <span className="text-faint">backed</span>
          <span className="text-faint">·</span>
          <span className="text-body tabular-nums">{backers}</span>
          <span className="text-faint">backer{backers === 1 ? "" : "s"}</span>
        </div>

        <div className="mt-auto pt-2">
          {done ? (
            <div className="font-mono text-[12px] text-pos text-center py-2">
              Backed ✓ — shows once confirmed
            </div>
          ) : !p.projectWallet ? (
            <div className="font-mono text-[11.5px] text-faint text-center py-2">
              backing opens shortly
            </div>
          ) : !open ? (
            <button
              onClick={() => setOpen(true)}
              className="w-full font-display font-semibold text-[13.5px] py-[9px] rounded-[10px] border border-accent-tint-border text-accent-text hover:bg-accent-tint transition-colors"
            >
              Back this launch
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  className="loop-input w-full font-mono text-[13px] pr-9"
                  aria-label="SOL amount to back"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-faint">
                  SOL
                </span>
              </div>
              <button
                onClick={back}
                disabled={busy}
                className="font-display font-semibold text-[13px] px-3 py-[9px] rounded-[10px] bg-accent text-white hover:bg-accent-d transition-colors disabled:opacity-60"
              >
                {busy ? "…" : wallet.connected ? "Send" : "Connect"}
              </button>
            </div>
          )}
          {err && <div className="text-[11.5px] text-warn mt-1 text-center">{err}</div>}
        </div>
      </div>
    </div>
  );
}
