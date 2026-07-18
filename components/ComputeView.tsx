"use client";

import Link from "next/link";
import { LoopMark } from "./LoopMark";
import { useWallet } from "@/lib/wallet";
import { NavUserActions } from "./NavUserActions";
import { shortAge } from "@/lib/format";
import type { ComputePoolStats } from "@/lib/device-assists";

// The /compute page: Loop's device pool made visible. Consumer devices (Macs,
// iPhones) prepare backlog work for the agents and earn rewards. Honest empty
// state — no invented devices — matching the rest of the product.
export function ComputeView({ stats }: { stats: ComputePoolStats }) {
  const wallet = useWallet();
  const lastAgo =
    stats.lastAssistAt != null
      ? shortAge((Date.now() - Date.parse(stats.lastAssistAt)) / 1000)
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

      <main className="max-w-[680px] mx-auto px-6 sm:px-8 py-7">
        <div className="mb-5">
          <h1 className="font-display font-bold text-[24px] tracking-[-0.02em] m-0">Compute pool</h1>
          <p className="text-[13px] text-muted mt-1 mb-0">
            Consumer devices lend spare compute to Loop&apos;s autonomous agents — preparing
            backlog work on-device, no datacenter. {lastAgo ? `Last assist ${lastAgo} ago.` : ""}
          </p>
        </div>

        {/* Headline stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <Stat label="Assists" value={fmt(stats.totalAssists)} title="Backlog items prepared by devices" />
          <Stat
            label="Devices"
            value={stats.contributors > 0 ? fmt(stats.contributors) : "—"}
            title="Distinct contributing devices (needs the device_assists table)"
          />
          <Stat
            label="With payout"
            value={stats.contributorsWithPayout > 0 ? fmt(stats.contributorsWithPayout) : "—"}
            title="Devices with a reward wallet set"
          />
          <Stat label="Projects" value={fmt(stats.byProject.length)} title="Projects receiving device assists" />
        </div>

        {/* Per-project */}
        {stats.byProject.length > 0 && (
          <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-[18px] mb-4">
            <div className="font-display font-semibold text-[15px] mb-3">By project</div>
            <div className="flex flex-col gap-[10px]">
              {stats.byProject.map((p) => (
                <div key={p.projectKey} className="flex items-center justify-between font-mono text-[12.5px]">
                  <span className="text-ink">${p.projectKey.toUpperCase()}</span>
                  <span className="text-muted">
                    {fmt(p.assists)} assists{p.devices > 0 ? ` · ${p.devices} device${p.devices > 1 ? "s" : ""}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top contributors */}
        <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-[18px] mb-4">
          <div className="font-display font-semibold text-[15px] mb-3">Top contributors</div>
          {stats.topContributors.length === 0 ? (
            <div className="text-[13px] text-faint">
              {stats.source === "agent_actions"
                ? "Per-device attribution turns on once the device_assists table is live."
                : "No device contributions yet — be the first."}
            </div>
          ) : (
            <div className="flex flex-col gap-[10px]">
              {stats.topContributors.map((c, i) => (
                <div key={c.device + i} className="flex items-center justify-between font-mono text-[12.5px]">
                  <span className="text-ink truncate max-w-[60%]">
                    <span className="text-faint mr-2">{i + 1}.</span>
                    {c.device}
                  </span>
                  <span className="text-muted">
                    {fmt(c.assists)} assists
                    {c.hasPayout ? <span className="text-[var(--pos)] ml-2">◆ payout</span> : null}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* How it works / join */}
        <div className="bg-surface-2 border border-line-3 rounded-[16px] px-5 py-[18px]">
          <div className="font-display font-semibold text-[15px] mb-2">Lend your device</div>
          <p className="text-[13px] text-muted mt-0 mb-3">
            A Mac or iPhone, idle and plugged in, prepares real backlog work for a project&apos;s
            agent — an analysis brief thought through on-device — and earns rewards in that
            project&apos;s token. Proofs are cross-checked across devices, so the pool polices itself.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/explore"
              className="font-mono text-[12px] px-3 py-[7px] rounded-[10px] border border-line-3 hover:border-line-hover transition-colors"
            >
              Explore projects
            </Link>
            <a
              href="https://looplabs.fun/api/compute/stats"
              className="font-mono text-[12px] px-3 py-[7px] rounded-[10px] border border-line-3 hover:border-line-hover transition-colors text-muted"
            >
              Pool API
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title} className="rounded-[9px] border border-line-4 bg-surface-2 px-3 py-2">
      <div className="font-mono text-[10px] text-faint uppercase tracking-wide">{label}</div>
      <div className="font-display font-semibold text-[14px] text-ink mt-[1px] truncate">{value}</div>
    </div>
  );
}
