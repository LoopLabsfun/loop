"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { LoopMark } from "../LoopMark";
import { NavUserActions } from "../NavUserActions";
import { ChainSwitch } from "../ChainSwitch";
import { Chart } from "./Chart";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { useLiveMarket, type Timeframe } from "@/lib/useLiveMarket";
import { useLiveTreasury } from "@/lib/useLiveTreasury";
import { buildSwapTx } from "@/lib/pump";
import { AgentFeed } from "./AgentFeed";
import { AgentOperator } from "./AgentOperator";
import { ProjectSettings } from "./ProjectSettings";
import { ProjectWallet } from "./ProjectWallet";
import { AgentFace } from "./AgentFace";
import { AgentEngine } from "../AgentEngine";
import { InspectorDrawer } from "./InspectorDrawer";
import { InspectorProvider, useInspector } from "@/lib/inspector";
import type { AgentState } from "@/lib/agent-data";
import type { ComputeSummary } from "@/lib/anthropic-cost";
import type { ChatMsg } from "@/lib/chat";
import type { Candle, Holder, MarketStats, Project, Trade } from "@/lib/types";
import { fmtPrice, shortAge, explorerUrl, explorerTx, shortAddr, usd, compactUsd } from "@/lib/format";
import { infraBreakdown, parseSolPerDay, type CostKey } from "@/lib/economics";
import {
  loopLedger,
  withCompute,
  ledgerSummary,
  runwayMonths,
  type LedgerEntry,
  type Cadence,
} from "@/lib/ledger";
import { agentRunState, canAffordTick } from "@/lib/budget";
import { boostTierFor, BOOST_TIERS } from "@/lib/stake";
import { splitForProject } from "@/lib/fees";
import { claimable, ZERO_FEE_LEDGER, type FeeLedger } from "@/lib/fee-ledger";
import { TREASURY_EXITS } from "@/lib/governance";

export interface LiveMarket {
  stats: MarketStats | null;
  candles: Candle[];
  trades: Trade[];
  holders: Holder[];
}

export function TokenPage({
  project: p,
  market,
  agentSol,
  solUsd,
  commits,
  matchCommits,
  agentState,
  chat,
  compute,
  feeLedger,
  visitors,
  hero = "classic",
}: {
  project: Project;
  market: LiveMarket;
  agentSol?: number | null;
  solUsd: number;
  commits: { hash: string; msg: string }[];
  /** Wider commit window to link shipped LIVE-LOG rows to their commit. */
  matchCommits?: { hash: string; msg: string }[];
  agentState?: AgentState;
  chat?: ChatMsg[];
  /** Real Claude API spend + remaining credit (official project only), or null. */
  compute?: ComputeSummary | null;
  /** Real per-role creator-fee accounting (earned/claimed), or zero until any claim. */
  feeLedger?: FeeLedger;
  /** Total Vercel visitors since launch, or null when unconfigured. */
  visitors?: number | null;
  /** "classic" = the public v1 header; "merged" = the v2 hero (identity + price +
   *  buy on the left, the live agent on the right). Founder-only /admin/v2 preview. */
  hero?: "classic" | "merged";
}) {
  // Real commits from the repo only — no static sample (empty state otherwise).
  const commitFeed = commits;
  const wallet = useWallet();
  const { tf, mode, stats, candles, trades, changeTf, setMode, preLaunch } =
    useLiveMarket(p.mint, {
      stats: market.stats,
      candles: market.candles,
      trades: market.trades,
    });

  // Pre-launch (no mint) ⇒ no market: render honest "no market yet" states.
  // Live price + 24h change come straight from the market stats; the candle
  // series drives only the chart.
  const last = stats?.priceUsd ?? 0;
  const change = stats?.priceChange24h ?? 0;

  // v2 hero summary of the live agent: what it's building now (or the next queued
  // item) + its most recent ship + the self-funding-loop proof. Only used by the
  // "merged" hero. All derived from props already loaded — no extra fetch.
  const allTasks = agentState?.tasks ?? [];
  const buildingTask = allTasks.find((t) => t.status === "building");
  const heroTask = buildingTask ?? allTasks.find((t) => t.status === "todo");
  const lastShip = commitFeed[0];
  // The thesis, quantified: how much this token has actually built itself.
  const shippedCount = allTasks.filter((t) => t.status === "shipped").length;
  const onchainActions = agentState?.actions?.length ?? 0;
  // Compute spend is the token funding its OWN development — framed as proof, not
  // cost. Official-only (null elsewhere) ⇒ the strip degrades gracefully.
  const computeSpentUsd = compute?.spentUsd ?? null;
  // Honest liveness: relative time of the agent's current focus (when the building
  // task started, else when the next item was queued). undefined ⇒ omit.
  const heroTaskAt = heroTask?.at;

  return (
    <InspectorProvider project={p}>
      <TokenNav ticker={p.ticker} walletLabel={wallet.label} connected={wallet.connected} onToggle={wallet.toggle} />

      <main>
      {hero === "merged" ? (
        <MergedHero
          p={p}
          last={last}
          change={change}
          stats={stats}
          preLaunch={preLaunch}
          building={Boolean(buildingTask)}
          heroTaskTitle={heroTask?.title}
          heroTaskAt={heroTaskAt}
          tasks={agentState?.tasks}
          lastShip={lastShip}
          shippedCount={shippedCount}
          computeSpentUsd={computeSpentUsd}
          onchainActions={onchainActions}
        />
      ) : (
      <section className="max-w-[1280px] mx-auto px-8 pt-7 pb-5 flex items-center justify-between gap-6 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-[60px] h-[60px] rounded-[14px] border border-line-2 bg-accent-tint flex items-center justify-center">
            <LoopMark width={36} height={22} stroke="var(--accent)" />
          </div>
          <div>
            <div className="flex items-center gap-[10px] flex-wrap">
              <h1 className="font-display font-bold text-[26px] tracking-[-0.02em] m-0">
                {p.name}
              </h1>
              <span className="font-mono text-[13px] text-accent-text">{p.ticker}</span>
              {p.official && (
                <span className="font-mono text-[10.5px] px-2 py-[3px] rounded-[6px] bg-accent text-white">
                  OFFICIAL
                </span>
              )}
              {p.network === "devnet" && (
                <span className="font-mono text-[10.5px] px-2 py-[3px] rounded-[6px] border border-warn text-warn">
                  devnet
                </span>
              )}
              <AgentStatusBadge project={p} />
            </div>
            <p className="text-[13.5px] text-muted mt-[5px] mb-0">{p.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-7">
          <div>
            <div className="font-display font-bold text-[32px] tracking-[-0.02em] tabular-nums">
              {preLaunch ? "—" : fmtPrice(last)}
            </div>
            {preLaunch ? (
              <div className="font-mono text-[13px] text-faint">not launched</div>
            ) : (
              <div
                className="font-mono text-[13px]"
                style={{ color: change >= 0 ? "var(--pos)" : "var(--neg)" }}
              >
                {(change >= 0 ? "+" : "") + change.toFixed(2)}% · 24h
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pl-7 border-l border-line-2">
            {/* Live market values (DexScreener) when launched; fall back to the
                stored snapshot only pre-launch so nothing reads as stale/fake. */}
            <HeaderStat
              label="Market Cap"
              value={stats ? compactUsd(stats.marketCap) : p.marketCap}
              help="Token price × circulating supply — the market's live valuation of the project. It's also what the agent's mascot reacts to."
            />
            <HeaderStat
              label="Liquidity"
              value={stats ? compactUsd(stats.liquidityUsd) : p.liquidity}
              help="Value pooled for trading. Deeper liquidity = lower slippage when you buy or sell."
            />
            <HeaderStat
              label="Holders"
              value={p.holders}
              help="Distinct wallets holding the token. Click a wallet in the holders list to inspect it on-chain."
            />
            <HeaderStat
              label="24h Volume"
              value={stats ? compactUsd(stats.volume24hUsd) : p.volume24h}
              help="Total traded value over the last 24 hours — how active the market is right now."
            />
          </div>
        </div>
      </section>
      )}

      {/* Main grid */}
      <section className="max-w-[1280px] mx-auto px-8 pb-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_350px] gap-4 items-start">
        {/* Left column — min-w-0 + the minmax(0,1fr) track above let long
            unbreakable content (e.g. an email preview) truncate inside the column
            instead of forcing it wider than the viewport. */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Agent — one feed: ask the agent ($LOOP-metered, answers in the side
              panel) AND steer it (directives/proposals/votes). */}
          <div id="agent" className="scroll-mt-4 rounded-[16px] jump-target">
            <AgentFeed
              project={p}
              directives={agentState?.directives}
              chat={chat}
              tasks={agentState?.tasks}
            />
          </div>
          {/* Agent Operator — what the agent does autonomously (tasks/inbox/social) */}
          <AgentOperator
            project={p}
            tasks={agentState?.tasks}
            inbox={agentState?.inbox}
            social={agentState?.social}
            summaries={agentState?.summaries}
            metrics={{ visitors, holders: p.holders }}
          />
          {/* Creator-only: edit brand/social + attach a custom domain (renders
              nothing unless the connected wallet is this project's creator). */}
          <ProjectSettings project={p} />
          {/* Project Wallet — the agent's on-chain positions (buyback/burn/airdrop) */}
          <ProjectWallet project={p} actions={agentState?.actions} agentSol={agentSol} />
          {/* Chart */}
          <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-[18px]">
            {preLaunch || candles.length === 0 ? (
              <div className="text-center py-12">
                <div className="font-display font-semibold text-[15px] text-ink mb-1">
                  No market yet
                </div>
                <div className="text-[12.5px] text-muted max-w-[380px] mx-auto">
                  {preLaunch
                    ? `${p.ticker} isn't minted yet. The price chart appears once the token launches on-chain and trading begins.`
                    : `No candle data for ${p.ticker} yet — the chart fills in as ${p.ticker} trades.`}
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-[14px]">
                  <Segmented<Timeframe>
                    value={tf}
                    onChange={changeTf}
                    options={["1H", "4H", "1D"]}
                  />
                  <Segmented
                    value={mode}
                    onChange={setMode}
                    options={["candles", "line"]}
                    labels={{ candles: "Candles", line: "Line" }}
                  />
                </div>
                <Chart candles={candles} mode={mode} />
                <div className="flex justify-between mt-[10px] font-mono text-[11px] text-faint">
                  <span>
                    {tf === "1H" ? "15m candles" : tf === "4H" ? "hourly candles" : "4h candles"}
                  </span>
                  <span className="inline-flex items-center gap-[6px]">
                    <span className="w-[6px] h-[6px] rounded-full bg-pos-bright animate-pulseFast" />
                    live · updates every 20s
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Trades */}
          <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-[18px]">
            <div className="flex items-center justify-between mb-3">
              <span className="font-display font-semibold text-[15px]">Recent Trades</span>
              {!preLaunch && trades.length > 0 && (
                <span className="inline-flex items-center gap-[6px] font-mono text-[11px] text-faint">
                  <span className="w-[6px] h-[6px] rounded-full bg-pos-bright animate-pulseFast" />
                  live
                </span>
              )}
            </div>
            {preLaunch || trades.length === 0 ? (
              <div className="text-[12.5px] text-faint text-center py-8">
                {preLaunch
                  ? `No trades yet — trading opens when ${p.ticker} launches on-chain.`
                  : `No recent trades for ${p.ticker}.`}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_1fr_1fr_1fr_0.8fr] gap-2 font-mono text-[11px] text-faint pb-2 border-b border-line-4">
                  <span>ACCOUNT</span>
                  <span>TYPE</span>
                  <span>SOL</span>
                  <span>TOKENS</span>
                  <span className="text-right">AGE</span>
                </div>
                {trades.map((t, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_1fr_1fr_1fr_0.8fr] gap-2 font-mono text-[12.5px] py-[9px] border-b border-[#F8F7FA] animate-fadeInFast"
                  >
                    <span className="text-muted">{t.addr}</span>
                    <span style={{ color: t.side === "BUY" ? "var(--pos)" : "var(--neg)" }}>
                      {t.side}
                    </span>
                    <span>{t.sol}</span>
                    <span className="text-muted">{t.tokens}</span>
                    <span className="text-faint text-right">{shortAge(t.ageSeconds)} ago</span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Agent activity — shared loop-engine terminal (same as the home). */}
          <AgentEngine
            repo={p.repo}
            label={p.ticker}
            commits={commitFeed}
            matchCommits={matchCommits}
            tasks={agentState?.tasks}
            live={agentState?.live}
          />
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          {/* The mascot: shown here in v1; in v2 it lives in the hero (single placement). */}
          {hero !== "merged" && (
            <div className="bg-surface border border-line-2 rounded-[16px] p-[14px] flex items-center justify-center">
              <AgentFace
                project={p}
                tasks={agentState?.tasks}
                size="lg"
                market={{ changePct: change }}
              />
            </div>
          )}
          <div id="swap" className="scroll-mt-4 rounded-[16px] jump-target">
            {p.prelaunch ? (
              <PrelaunchBackCard project={p} />
            ) : (
              <SwapCard project={p} lastPrice={last} solUsd={solUsd} preLaunch={preLaunch} />
            )}
          </div>
          <BondingCurve curve={p.curve} graduated={stats?.graduated} />
          {p.official && <BoostTierCard project={p} preLaunch={preLaunch} />}
          <TreasuryStats project={p} solUsd={solUsd} compute={compute} />
          <FeesCustodyCard project={p} preLaunch={preLaunch} feeLedger={feeLedger} />
          <TopHolders holders={market.holders} network={p.network ?? "mainnet"} preLaunch={preLaunch} />

        </div>
      </section>
      </main>

      <footer className="border-t border-line py-[22px] px-8 max-w-[1280px] mx-auto flex items-center justify-between">
        <span className="text-[12.5px] text-faint">© 2026 Loop · {p.network ?? "mainnet"}</span>
        <AgentStatusBadge project={p} />
      </footer>

      {/* Right-side detail drawer — opens when any element calls inspect() */}
      <InspectorDrawer />
    </InspectorProvider>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);

  const onShare = async () => {
    const url = typeof window === "undefined" ? "" : window.location.href;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // user cancelled the share sheet — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — nothing more we can do
    }
  };

  return (
    <button
      onClick={onShare}
      aria-label="Share this project"
      className="flex items-center gap-[7px] font-mono text-[13px] px-3 sm:px-4 py-[9px] rounded-[10px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors whitespace-nowrap"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M8.7 13.5l6.6 3.8M15.3 6.7L8.7 10.5M18 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0zM9 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0zM18 17a3 3 0 1 0-6 0 3 3 0 0 0 6 0z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={copied ? "text-pos" : undefined}>
        {copied ? "Copied" : "Share"}
      </span>
    </button>
  );
}

function TokenNav({
  ticker,
  walletLabel,
  connected,
  onToggle,
}: {
  ticker: string;
  walletLabel: string;
  connected: boolean;
  onToggle: () => void;
}) {
  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between gap-2 px-4 sm:px-8 py-[14px] bg-canvas/[0.88] backdrop-blur-md border-b border-line">
      <div className="flex items-center gap-[10px] sm:gap-[14px] min-w-0">
        <Link href="/" className="flex items-center gap-[10px] text-ink flex-none">
          <LoopMark width={30} height={18} />
          <span className="font-display font-bold text-[19px] tracking-[-0.02em]">Loop</span>
        </Link>
        <span className="text-line-hover">/</span>
        <span className="font-mono text-[13px] text-accent-text truncate">{ticker}</span>
      </div>
      <div className="flex items-center gap-[8px] sm:gap-[10px] flex-none">
        <ChainSwitch className="hidden md:flex" />
        <ShareButton />
        <Link
          href="/"
          className="hidden sm:inline-block text-[13.5px] text-muted hover:text-ink transition-colors px-[14px] py-[9px]"
        >
          ← All projects
        </Link>
        <NavUserActions messagesHidden />
        <button
          onClick={onToggle}
          className="flex items-center gap-[7px] font-mono text-[13px] px-3 sm:px-4 py-[9px] rounded-[10px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors whitespace-nowrap"
        >
          {connected && <span className="w-[7px] h-[7px] rounded-full bg-pos-bright inline-block" />}
          {walletLabel}
        </button>
      </div>
    </nav>
  );
}

// v2 hero (founder-only /admin/v2 preview): identity + contract + price + Buy on
// the left, the LIVE agent on the right — mascot, what it's building now (with
// freshness), the SELF-FUNDING-LOOP proof (features shipped · compute the token
// spent building itself · on-chain actions), and the last ship. So a first-time
// visitor grasps the whole thesis — "this token funds an agent that ships, here
// it is working" — above the fold. Everything is project-data-driven (no LOOP
// hardcoding) so it works verbatim for every future token. Reuses the same
// HeaderStat / AgentFace / AgentStatusBadge as the classic header.
function MergedHero({
  p,
  last,
  change,
  stats,
  preLaunch,
  building,
  heroTaskTitle,
  heroTaskAt,
  tasks,
  lastShip,
  shippedCount,
  computeSpentUsd,
  onchainActions,
}: {
  p: Project;
  last: number;
  change: number;
  stats: MarketStats | null;
  preLaunch: boolean;
  building: boolean;
  heroTaskTitle?: string;
  heroTaskAt?: string;
  tasks?: AgentState["tasks"];
  lastShip?: { hash: string; msg: string };
  shippedCount: number;
  computeSpentUsd: number | null;
  onchainActions: number;
}) {
  return (
    <section className="max-w-[1280px] mx-auto px-8 pt-7 pb-5">
      <div className="bg-surface border border-line-2 rounded-[16px] px-6 py-5 grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-6 items-stretch">
        {/* Left — identity · contract · price · buy */}
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-[10px] flex-wrap">
            <div className="relative w-[42px] h-[42px] rounded-[12px] border border-line-2 bg-accent-tint flex items-center justify-center flex-none overflow-hidden">
              <LoopMark width={26} height={16} stroke="var(--accent)" />
              {p.tokenImageUrl && (
                <img
                  src={p.tokenImageUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  // Broken/404 image → hide so the LoopMark behind shows (never a broken icon).
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
            </div>
            <h1 className="font-display font-bold text-[24px] tracking-[-0.02em] m-0">{p.name}</h1>
            <span className="font-mono text-[13px] text-accent-text">{p.ticker}</span>
            {p.official && (
              <span className="font-mono text-[10.5px] px-2 py-[3px] rounded-[6px] bg-accent text-white">OFFICIAL</span>
            )}
            {p.network === "devnet" && (
              <span className="font-mono text-[10.5px] px-2 py-[3px] rounded-[6px] border border-warn text-warn">devnet</span>
            )}
          </div>

          {/* Contract address — copyable, vanity suffix highlighted, explorer link.
              A trust + anti-impersonation cue, and it shows off the "…Loop" vanity. */}
          {p.mint && (
            <CopyableCA mint={p.mint} network={p.network === "devnet" ? "devnet" : "mainnet"} chain={p.chain ?? "solana"} />
          )}

          <p className="text-[13px] text-muted mt-2 mb-0 max-w-[460px] leading-[1.5]">{p.description}</p>

          <div className="flex items-baseline gap-3 mt-4">
            <span className="font-display font-bold text-[30px] tracking-[-0.02em] tabular-nums">
              {preLaunch ? "—" : fmtPrice(last)}
            </span>
            {preLaunch ? (
              <span className="font-mono text-[13px] text-faint">not launched</span>
            ) : (
              <span className="font-mono text-[13px]" style={{ color: change >= 0 ? "var(--pos)" : "var(--neg)" }}>
                {(change >= 0 ? "▲ " : "▼ ") + (change >= 0 ? "+" : "") + change.toFixed(2)}% · 24h
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 mt-3">
            <HeaderStat
              label="Market Cap"
              value={stats ? compactUsd(stats.marketCap) : p.marketCap}
              help="Token price × circulating supply — the market's live valuation of the project. It's also what the agent's mascot reacts to."
            />
            <HeaderStat
              label="Liquidity"
              value={stats ? compactUsd(stats.liquidityUsd) : p.liquidity}
              help="Value pooled for trading. Deeper liquidity = lower slippage when you buy or sell."
            />
            <HeaderStat
              label="Holders"
              value={p.holders}
              help="Distinct wallets holding the token. Click a wallet in the holders list to inspect it on-chain."
            />
            <HeaderStat
              label="24h Volume"
              value={stats ? compactUsd(stats.volume24hUsd) : p.volume24h}
              help="Total traded value over the last 24 hours — how active the market is right now."
            />
          </div>

          {/* Buy is the primary action; selling something you don't own yet has no
              place as a co-equal CTA on a first visit — demote it to a quiet link.
              Pre-launch there's nothing to trade yet — the primary action is to
              back the launch (pre-fund the treasury), refundable until it mints. */}
          <div className="mt-auto pt-5">
            <a
              href="#swap"
              className="w-full h-[44px] rounded-[10px] bg-accent text-white font-display font-semibold text-[15px] flex items-center justify-center hover:opacity-90 transition-opacity"
            >
              {p.prelaunch ? "Back this launch" : `Buy ${p.ticker}`}
            </a>
            {p.prelaunch ? (
              <span className="block text-center font-mono text-[12px] text-faint mt-2">
                refundable until {p.ticker} launches
              </span>
            ) : (
              <a
                href="#swap"
                className="block text-center font-mono text-[12px] text-faint hover:text-accent-text transition-colors mt-2"
              >
                or sell {p.ticker} ↓
              </a>
            )}
          </div>
        </div>

        {/* Right — the live agent: status + what it's doing now + the self-funding
            loop proof + last ship. The differentiator, given its own column. */}
        <div className="flex flex-col min-w-0 border-t border-line-2 pt-5 lg:border-t-0 lg:pt-0 lg:border-l lg:pl-6">
          <div className="mb-3">
            <AgentStatusBadge project={p} />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-none">
              <AgentFace project={p} tasks={tasks} size="md" market={{ changePct: change }} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-faint mb-[2px]">
                {p.prelaunch ? "Status" : building ? "Building now" : "Next up"}
                {!p.prelaunch && heroTaskAt && <span className="text-faint"> · {heroTaskAt}</span>}
              </div>
              <div className="text-[13px] text-ink leading-[1.35]">
                {p.prelaunch
                  ? `Agent initializing — boots when ${p.ticker} launches on-chain`
                  : heroTaskTitle ?? "Steering the roadmap"}
              </div>
            </div>
          </div>

          {/* The thesis, quantified — the self-funding loop made legible. */}
          <LoopProof
            shippedCount={shippedCount}
            computeSpentUsd={computeSpentUsd}
            onchainActions={onchainActions}
          />

          {lastShip && (
            <div className="text-[11.5px] text-muted mt-3 pt-3 border-t border-line-4 leading-[1.5]">
              <span className="text-pos">✓ last ship</span> · {shipLabel(lastShip.msg)}
              <span className="font-mono text-faint"> · {lastShip.hash.slice(0, 7)}</span>
            </div>
          )}
          <a
            href="#agent"
            className="mt-auto inline-flex items-center justify-center gap-[6px] h-[34px] rounded-[10px] border border-line-2 text-[13px] hover:bg-surface-2 transition-colors"
          >
            Ask the agent
          </a>
        </div>
      </div>
    </section>
  );
}

/** Strip a leading conventional-commit prefix ("feat(scope): ", "fix: ") so the
 *  last-ship line reads as a product change, not a git subject. */
function shipLabel(msg: string): string {
  return msg.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "");
}

// The self-funding-loop proof: how much this token has actually built itself.
// Generic across tokens — compute spend (official-only) and on-chain actions are
// omitted when absent, so a brand-new token shows just its shipped count.
function LoopProof({
  shippedCount,
  computeSpentUsd,
  onchainActions,
}: {
  shippedCount: number;
  computeSpentUsd: number | null;
  onchainActions: number;
}) {
  const items: { value: string; label: string }[] = [
    { value: String(shippedCount), label: shippedCount === 1 ? "feature shipped" : "features shipped" },
  ];
  if (computeSpentUsd != null && computeSpentUsd > 0) {
    items.push({ value: usd(computeSpentUsd), label: "spent building itself" });
  }
  if (onchainActions > 0) {
    items.push({ value: String(onchainActions), label: onchainActions === 1 ? "on-chain action" : "on-chain actions" });
  }
  return (
    <div className="mt-4 rounded-[12px] border border-line-2 bg-surface-2/60 px-3 py-[10px]">
      <div className="text-[9.5px] uppercase tracking-[0.06em] text-faint mb-2">↻ self-funding loop</div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {items.map((it) => (
          <div key={it.label}>
            <div className="font-display font-bold text-[17px] tracking-[-0.01em] tabular-nums text-ink leading-none">
              {it.value}
            </div>
            <div className="text-[10.5px] text-muted mt-[3px]">{it.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Copyable contract address with the vanity suffix (last 4 chars) highlighted and
// an explorer link. Client-only clipboard with a brief "copied" confirmation.
function CopyableCA({
  mint,
  network,
  chain = "solana",
}: {
  mint: string;
  network: "mainnet" | "devnet";
  chain?: "solana" | "hood";
}) {
  const [copied, setCopied] = useState(false);
  const head = mint.slice(0, 4);
  const tail = mint.slice(-4);
  return (
    <div className="flex items-center gap-2 mt-2">
      <span className="text-[9.5px] uppercase tracking-[0.06em] text-faint">CA</span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(mint).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            },
            () => {}
          );
        }}
        title="Copy contract address"
        className="group font-mono text-[11.5px] inline-flex items-center gap-[6px] px-2 h-[24px] rounded-[7px] bg-surface-2 border border-line-2 hover:border-accent/50 transition-colors"
      >
        <span className="text-muted">{head}…</span>
        <span className="text-accent-text font-semibold">{tail}</span>
        <span className="text-faint group-hover:text-accent-text">{copied ? "✓ copied" : "⧉"}</span>
      </button>
      <a
        href={explorerUrl(mint, network, chain)}
        target="_blank"
        rel="noreferrer"
        className="text-[11px] text-faint hover:text-accent-text transition-colors"
      >
        explorer ↗
      </a>
    </div>
  );
}

function HeaderStat({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help?: string;
}) {
  const { inspect } = useInspector();
  return (
    <button
      onClick={() => inspect({ kind: "stat", stat: { label, value, help } })}
      title={`Inspect ${label}`}
      className="text-left hover:opacity-80 transition-opacity"
    >
      <div className="text-[11px] text-faint mb-[3px]">{label}</div>
      <div className="font-mono text-[14px]">{value}</div>
    </button>
  );
}

// Honest agent status — reflects the real budget gate (the cron skips a project
// whose treasury can't afford a cycle), not a hardcoded "active".
function AgentStatusBadge({ project: p }: { project: Project }) {
  const state = agentRunState(p);
  if (state === "pre-launch") {
    return <span className="font-mono text-[11.5px] text-faint">● pre-launch</span>;
  }
  if (state === "asleep") {
    const b = canAffordTick(p);
    return (
      <span
        className="font-mono text-[11.5px] text-warn"
        title={`Agent asleep — treasury ${b.treasurySol} SOL, needs ${b.needSol.toFixed(
          3
        )} SOL to run a cycle. Fund the project treasury (not the agent wallet) to wake it.`}
      >
        ● asleep · treasury empty
      </span>
    );
  }
  return <span className="font-mono text-[11.5px] text-pos">● agent active</span>;
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  labels,
}: {
  value: T;
  onChange: (v: T) => void;
  options: T[];
  labels?: Record<string, string>;
}) {
  return (
    <div className="flex gap-1 bg-surface-3 rounded-[9px] p-[3px]">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`font-mono text-[12px] px-[14px] py-[6px] rounded-[7px] transition-colors ${
              active ? "bg-ink text-white" : "bg-transparent text-muted"
            }`}
          >
            {labels?.[opt] ?? opt}
          </button>
        );
      })}
    </div>
  );
}

function SwapCard({
  project: p,
  lastPrice,
  solUsd,
  preLaunch,
}: {
  project: Project;
  lastPrice: number;
  solUsd: number;
  preLaunch?: boolean;
}) {
  const wallet = useWallet();
  const { network, setNetwork } = useNetwork();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState("1.0");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle"
  );
  const [sig, setSig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const sym = p.ticker.slice(1);
  const buy = side === "buy";
  const amtN = parseFloat(amt) || 0;
  const projectNet = p.network ?? "mainnet";
  const wrongNet = network !== projectNet;

  // Live wallet balance for the active side (SOL when buying, the token when
  // selling) so we can show it and fill a "Max". Re-read when the side, wallet,
  // network, or a settled swap changes. Leave a little SOL for tx fees on a Max
  // buy so the swap can still pay its fee.
  const SOL_FEE_BUFFER = 0.01;
  const [bal, setBal] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!wallet.connected || !wallet.address || wrongNet || !p.mint) {
      setBal(null);
      return;
    }
    void (async () => {
      const v = buy
        ? await wallet.getSolBalance()
        : await wallet.getSplBalance(p.mint!);
      if (!cancelled) setBal(v);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.address, buy, wrongNet, p.mint, status]);

  const setMax = () => {
    if (bal == null) return;
    const max = buy ? Math.max(0, bal - SOL_FEE_BUFFER) : bal;
    setAmt(buy ? max.toFixed(3) : String(Math.floor(max)));
  };

  // Hood projects: on-curve trading arrives with the Hood launcher wiring
  // (docs/multichain-hood.md Phase 3) — until then, an honest disabled state.
  if (p.chain === "hood") {
    return (
      <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
        <div className="font-display font-semibold text-[15px] mb-1">
          Trade {p.ticker}
        </div>
        <div className="text-[12.5px] text-muted leading-[1.5] mb-3">
          {p.ticker} lives on Hood (Robinhood Chain). Trading from this page
          opens when the Hood launcher goes live.
        </div>
        <button
          disabled
          className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[11px] bg-surface-3 text-faint cursor-not-allowed"
        >
          Hood trading opens soon
        </button>
      </div>
    );
  }

  // Pre-launch: no token to trade yet. Show an honest disabled state instead of
  // a simulated swap. To donate to the treasury, the Fund card is used instead.
  if (preLaunch) {
    return (
      <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
        <div className="font-display font-semibold text-[15px] mb-1">
          Trade {p.ticker}
        </div>
        <div className="text-[12.5px] text-muted leading-[1.5] mb-3">
          Trading opens when {p.ticker} is minted on-chain. You can already fund
          the treasury below to extend the agent&apos;s runway.
        </div>
        <button
          disabled
          className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[11px] bg-surface-3 text-faint cursor-not-allowed"
        >
          Trading opens at launch
        </button>
      </div>
    );
  }

  const est = buy
    ? Math.round((amtN * solUsd) / lastPrice).toLocaleString("en-US") + " " + sym
    : ((amtN * lastPrice) / solUsd).toFixed(3) + " SOL";

  const quicks: [string, string][] = buy
    ? [["0.1", "0.1"], ["0.5", "0.5"], ["1", "1"], ["5", "5"]]
    : [["1000", "1K"], ["10000", "10K"], ["100000", "100K"], ["500000", "500K"]];

  const doSwap = async () => {
    if (!wallet.connected || !wallet.address) {
      wallet.connect();
      return;
    }
    if (wrongNet || !p.mint || amtN <= 0 || status === "sending") return;
    setStatus("sending");
    setErr(null);
    setSig(null);
    try {
      const txBytes = await buildSwapTx({
        publicKey: wallet.address,
        action: side,
        mint: p.mint,
        amount: amtN,
      });
      const s = await wallet.sendSwapTx(txBytes);
      setSig(s);
      setStatus("done");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Swap failed";
      setErr(/reject|denied|cancel/i.test(msg) ? "Cancelled in wallet" : msg);
      setStatus("error");
    }
  };

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="grid grid-cols-2 gap-1 bg-surface-3 rounded-[10px] p-[3px] mb-[14px]">
        <button
          onClick={() => {
            setSide("buy");
            setAmt("1.0");
          }}
          className={`font-display font-semibold text-[14px] py-[9px] rounded-[8px] transition-colors ${
            buy ? "bg-[oklch(0.55_0.15_150)] text-white" : "text-muted"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => {
            setSide("sell");
            setAmt("10000");
          }}
          className={`font-display font-semibold text-[14px] py-[9px] rounded-[8px] transition-colors ${
            !buy ? "bg-[oklch(0.55_0.17_25)] text-white" : "text-muted"
          }`}
        >
          Sell
        </button>
      </div>

      <div className="flex items-baseline justify-between mb-[6px]">
        <label className="text-[12px] text-muted">
          {buy ? "Amount in SOL" : `Amount in ${sym}`}
        </label>
        {wallet.connected && !wrongNet && bal != null && (
          <span className="font-mono text-[11px] text-faint">
            {buy
              ? `${bal.toFixed(3)} SOL`
              : `${Math.floor(bal).toLocaleString("en-US")} ${sym}`}{" "}
            ·{" "}
            <button
              onClick={setMax}
              className="text-accent-text hover:text-accent-d transition-colors"
            >
              Max
            </button>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 border border-line-3 rounded-[10px] p-1 pl-[14px] mb-[10px]">
        <input
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          className="flex-1 border-0 outline-none font-mono text-[16px] py-2 bg-transparent min-w-0"
        />
        <span className="font-mono text-[12px] text-faint px-[10px] py-2 bg-surface-3 rounded-[7px]">
          {buy ? "SOL" : sym}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-[6px] mb-3">
        {quicks.map(([v, label]) => (
          <button
            key={label}
            onClick={() => setAmt(v)}
            className="font-mono text-[11.5px] py-[6px] border border-line-3 rounded-[7px] bg-surface text-muted hover:border-line-hover transition-colors"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex justify-between text-[12.5px] text-muted mb-[14px]">
        <span>You receive</span>
        <span className="font-mono text-ink">{est}</span>
      </div>

      {wrongNet ? (
        <button
          onClick={() => setNetwork(projectNet)}
          className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[11px] border border-warn text-warn"
        >
          Switch to {projectNet} to trade
        </button>
      ) : (
        <button
          onClick={doSwap}
          disabled={status === "sending" || (wallet.connected && amtN <= 0)}
          className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[11px] text-white transition-opacity disabled:opacity-60"
          style={{
            background: wallet.connected
              ? buy
                ? "oklch(0.55 0.15 150)"
                : "oklch(0.55 0.17 25)"
              : "#16131A",
          }}
        >
          {!wallet.connected
            ? "Connect Wallet"
            : status === "sending"
            ? "Confirm in wallet…"
            : buy
            ? `Buy ${p.ticker}`
            : `Sell ${p.ticker}`}
        </button>
      )}

      {status === "done" && sig && (
        <a
          href={explorerTx(sig, projectNet)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-[10px] block font-mono text-[11.5px] text-pos bg-[oklch(0.97_0.03_150)] border border-[oklch(0.9_0.06_150)] rounded-[8px] px-3 py-[9px] animate-fadeIn"
        >
          ✓ Swap sent · {shortAddr(sig)} ↗
        </a>
      )}
      {status === "error" && err && (
        <div className="mt-[10px] font-mono text-[11.5px] text-neg bg-[oklch(0.97_0.03_25)] border border-[oklch(0.9_0.06_25)] rounded-[8px] px-3 py-[9px] animate-fadeIn">
          {err}
        </div>
      )}
      <div className="mt-[10px] text-[11px] text-faint text-center">
        Swaps route through pump.fun · 1% of every trade funds the treasury
      </div>
      {p.mint && (
        <a
          href={`https://pump.fun/coin/${p.mint}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-[6px] block text-center font-mono text-[11px] text-accent-text hover:text-accent-d transition-colors"
        >
          or trade on pump.fun ↗
        </a>
      )}
    </div>
  );
}

// Pre-launch backing — the token isn't minted yet, so instead of a swap the
// primary action is to PRE-FUND the project's treasury (its future on-chain
// wallet). A conviction deposit ("yes, Loop should launch this"), refundable
// until the mint. Sends SOL straight to p.treasuryWallet (the deposit address),
// then reconciles the on-chain transfer into the contribution ledger so the
// backing counters update without a founder running the admin sync.
function PrelaunchBackCard({ project: p }: { project: Project }) {
  const wallet = useWallet();
  const { network, setNetwork } = useNetwork();
  const projectNet = p.network ?? "mainnet";
  const wrongNet = network !== projectNet;
  const [amt, setAmt] = useState("0.1");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [sig, setSig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const amtN = parseFloat(amt) || 0;

  const back = async () => {
    if (!wallet.connected || !wallet.address) {
      wallet.connect();
      return;
    }
    if (wrongNet || !p.treasuryWallet || amtN <= 0 || status === "sending") return;
    setStatus("sending");
    setErr(null);
    setSig(null);
    try {
      const s = await wallet.sendSol(p.treasuryWallet, amtN);
      setSig(s);
      setStatus("done");
      // Fold the transfer into the ledger (best-effort — the SOL is on chain
      // regardless, and the founder's reconcile tooling still works).
      try {
        await fetch("/api/prelaunch/back", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: p.key }),
        });
      } catch {
        /* reconcile is best-effort */
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Backing failed";
      setErr(/reject|denied|cancel/i.test(msg) ? "Cancelled in wallet" : msg);
      setStatus("error");
    }
  };

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="flex items-center justify-between mb-1">
        <span className="font-display font-semibold text-[15px]">Back this launch</span>
        <span className="font-mono text-[10.5px] px-2 py-[2px] rounded-full bg-accent-tint text-accent-text">
          opening soon
        </span>
      </div>
      <p className="text-[12.5px] text-muted leading-[1.5] mb-3">
        {p.ticker} isn&apos;t minted yet. Pre-fund its treasury to vote it up the
        queue and seed the agent&apos;s runway — refundable until it launches.
      </p>

      <div className="flex items-baseline justify-between mb-[6px]">
        <label className="text-[12px] text-muted">Amount in SOL</label>
      </div>
      <div className="flex items-center gap-2 border border-line-3 rounded-[10px] p-1 pl-[14px] mb-[10px]">
        <input
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          inputMode="decimal"
          className="flex-1 border-0 outline-none font-mono text-[16px] py-2 bg-transparent min-w-0"
          aria-label="SOL amount to back"
        />
        <span className="font-mono text-[12px] text-faint px-[10px] py-2 bg-surface-3 rounded-[7px]">
          SOL
        </span>
      </div>

      <div className="grid grid-cols-4 gap-[6px] mb-3">
        {["0.1", "0.5", "1", "5"].map((v) => (
          <button
            key={v}
            onClick={() => setAmt(v)}
            className="font-mono text-[11.5px] py-[6px] border border-line-3 rounded-[7px] bg-surface text-muted hover:border-line-hover transition-colors"
          >
            {v}
          </button>
        ))}
      </div>

      {wrongNet ? (
        <button
          onClick={() => setNetwork(projectNet)}
          className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[11px] border border-warn text-warn"
        >
          Switch to {projectNet} to back
        </button>
      ) : (
        <button
          onClick={back}
          disabled={status === "sending" || (wallet.connected && (amtN <= 0 || !p.treasuryWallet))}
          className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[11px] bg-accent text-white transition-opacity disabled:opacity-60"
        >
          {!wallet.connected
            ? "Connect Wallet"
            : status === "sending"
            ? "Confirm in wallet…"
            : !p.treasuryWallet
            ? "Backing opens shortly"
            : `Back with ${amtN || 0} SOL`}
        </button>
      )}

      {status === "done" && sig && (
        <a
          href={explorerTx(sig, projectNet)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-[10px] block font-mono text-[11.5px] text-pos bg-[oklch(0.97_0.03_150)] border border-[oklch(0.9_0.06_150)] rounded-[8px] px-3 py-[9px] animate-fadeIn"
        >
          ✓ Backed · {shortAddr(sig)} ↗
        </a>
      )}
      {status === "error" && err && (
        <div className="mt-[10px] font-mono text-[11.5px] text-neg bg-[oklch(0.97_0.03_25)] border border-[oklch(0.9_0.06_25)] rounded-[8px] px-3 py-[9px] animate-fadeIn">
          {err}
        </div>
      )}
      <div className="mt-[10px] text-[11px] text-faint text-center leading-[1.5]">
        Sent to the project&apos;s Loop-custodial treasury · refundable until launch
      </div>
    </div>
  );
}

function BondingCurve({
  curve,
  graduated: graduatedLive,
}: {
  curve: number;
  /** Live graduation from DexScreener; overrides the stored curve snapshot. */
  graduated?: boolean;
}) {
  // Trust the live on-chain signal first: a graduated token reads 100% regardless
  // of the stale stored `curve`. Fall back to the snapshot only when there's no
  // live market read yet.
  const graduated = graduatedLive ?? curve >= 1;
  const pct = graduated ? 100 : Math.min(100, Math.round(curve * 100));
  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="flex justify-between items-baseline mb-[10px]">
        <span className="font-display font-semibold text-[14.5px]">Bonding Curve</span>
        <span className="font-mono text-[12.5px] text-accent-text">
          {graduated ? "graduated" : `${pct}%`}
        </span>
      </div>
      <div className="h-[10px] rounded-full bg-[#F0EEF3] overflow-hidden mb-[10px]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,oklch(0.62_0.15_285),oklch(0.47_0.21_285))]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[12px] text-muted leading-[1.5]">
        {graduated
          ? "Curve complete — liquidity migrated off the pump.fun curve. Trading is fully open."
          : "Graduates once the bonding curve fills. Every buy moves the curve forward."}
      </div>
    </div>
  );
}

// Holder boost: a wallet's $LOOP balance unlocks which model the agent runs on
// its behalf (and its governance weight). Reads the connected wallet's live
// balance of the platform token (p.mint on the official project) and shows the
// current tier + progress to the next. Official project only (where p.mint == $LOOP).
function BoostTierCard({
  project: p,
  preLaunch,
}: {
  project: Project;
  preLaunch?: boolean;
}) {
  const wallet = useWallet();
  const { network } = useNetwork();
  const projectNet = p.network ?? "mainnet";
  const wrongNet = network !== projectNet;
  const [bal, setBal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!wallet.connected || !wallet.address || wrongNet || !p.mint) {
      setBal(null);
      return;
    }
    void (async () => {
      const v = await wallet.getSplBalance(p.mint!);
      if (!cancelled) setBal(v);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.address, wrongNet, p.mint]);

  const { current, next, toNext } = boostTierFor(bal);
  const connected = wallet.connected && !wrongNet && bal != null;
  const compact = (n: number) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="flex items-baseline justify-between mb-[10px]">
        <span className="font-display font-semibold text-[14.5px]">Holder Boost</span>
        {connected && (
          <span className="font-mono text-[12px] text-accent-text">
            {current ? current.name : "base"}
          </span>
        )}
      </div>
      <p className="text-[12px] text-muted leading-[1.5] mb-3">
        Hold {p.ticker} — the agent works on the model your balance unlocks, and your
        governance weight scales with it.
      </p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {BOOST_TIERS.map((t) => {
          const active = current?.name === t.name;
          return (
            <div
              key={t.name}
              className={`rounded-[9px] px-2 py-[8px] text-center border ${
                active ? "border-accent bg-accent-tint" : "border-line-4 bg-surface-2"
              }`}
              title={`Hold ${t.min.toLocaleString("en-US")} ${p.ticker} → ${t.name}`}
            >
              <div
                className={`font-mono font-semibold text-[12.5px] ${
                  active ? "text-accent-text" : "text-ink"
                }`}
              >
                {t.name}
              </div>
              <div className="text-[10.5px] text-faint mt-[1px]">
                {compact(t.min)}
              </div>
            </div>
          );
        })}
      </div>
      {connected ? (
        <div className="flex justify-between text-[12.5px] border-t border-line-4 pt-[10px]">
          <span className="text-muted">You hold</span>
          <span className="font-mono">
            {compact(bal ?? 0)} {p.ticker.replace(/^\$/, "")}
            {next && (
              <span className="text-faint">
                {" "}
                · {compact(toNext)} → {next.name}
              </span>
            )}
          </span>
        </div>
      ) : (
        <div className="text-[11.5px] text-faint border-t border-line-4 pt-[10px]">
          {preLaunch
            ? `${p.ticker} isn't tradable yet — boost tiers activate at launch.`
            : "Connect your wallet to see your boost tier."}
        </div>
      )}
    </div>
  );
}

function FeesCustodyCard({
  project: p,
  preLaunch,
  feeLedger,
}: {
  project: Project;
  preLaunch: boolean;
  feeLedger?: FeeLedger;
}) {
  const wallet = useWallet();
  const split = splitForProject(p);
  // The dev-fees claim is founder-only: visible just to the connected wallet
  // that matches the project's verified creator. Everyone else sees the split +
  // agent wallet (public) and a neutral note — no personal "Your dev-fees".
  const isCreator = !!(
    wallet.connected &&
    wallet.address &&
    p.creatorWallet &&
    wallet.address === p.creatorWallet
  );
  // REAL founder-claimable, read from the project's persisted fee_ledger (earned −
  // claimed, per role). The runtime writes this on every pump.fun creator-fee
  // sweep, split 30/65/5; before any claim it's an honest 0.
  const ledger = feeLedger ?? ZERO_FEE_LEDGER;
  const claims = claimable(ledger.earned, ledger.claimed);
  const founderClaimable = claims.founderSol;
  const hasClaimable = founderClaimable > 0;
  // Total creator fees swept to date (sum of the three role buckets). When > 0 we
  // surface the REAL per-role earned split below the modeled percentages, so the
  // "30/65/5" stops being decoration and shows actual SOL routed per role.
  const totalEarned =
    ledger.earned.founderSol + ledger.earned.agentSol + ledger.earned.platformSol;
  const hasEarned = totalEarned > 0;
  const net = p.network === "devnet" ? "devnet" : "mainnet";

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="font-display font-semibold text-[14.5px] mb-3">
        Creator Fees &amp; Custody
      </div>
      <div className="flex flex-col gap-[10px] text-[13px]">
        {/* Split */}
        <div className="flex justify-between">
          <span className="text-muted">Fee split</span>
          <span className="font-mono" title="founder / agent / platform">
            {split.founderPct} / {split.agentPct} / {split.platformPct}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <SplitChip label="Founder" pct={split.founderPct} tone="ink" />
          <SplitChip label="Agent" pct={split.agentPct} tone="accent" />
          <SplitChip label="Platform" pct={split.platformPct} tone="muted" />
        </div>

        {/* Real per-role earned — only once fees have actually been swept. Reads
            the persisted fee_ledger so the split is honest SOL, not just %. */}
        {hasEarned && (
          <div className="border-t border-line-4 pt-[10px] flex flex-col gap-[7px]">
            <div className="flex items-center justify-between">
              <span className="text-muted">Fees earned · routed</span>
              <span className="font-mono text-[12px] text-pos">
                {totalEarned.toFixed(4)} SOL
              </span>
            </div>
            <EarnedRow label="Founder" sol={ledger.earned.founderSol} />
            <EarnedRow label="Agent" sol={ledger.earned.agentSol} />
            <EarnedRow label="Platform" sol={ledger.earned.platformSol} />
          </div>
        )}

        {/* Agent wallet (external custody) */}
        <div className="flex justify-between border-t border-line-4 pt-[10px]">
          <span className="text-muted">Agent wallet</span>
          {p.agentWallet ? (
            <a
              href={explorerUrl(p.agentWallet, net, p.chain)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-accent-text hover:text-accent-d transition-colors"
            >
              {shortAddr(p.agentWallet)} ↗
            </a>
          ) : (
            <span className="font-mono text-faint">provisioning…</span>
          )}
        </div>

        {/* Dev-fees claim — founder-only */}
        {isCreator ? (
          <>
            <div className="flex justify-between border-t border-line-4 pt-[10px]">
              <span className="text-muted">Your dev-fees</span>
              <span className="font-mono">{founderClaimable.toFixed(4)} SOL</span>
            </div>
            <button
              disabled
              title={
                preLaunch
                  ? "Dev-fees accrue from trading once the token is live."
                  : hasClaimable
                    ? `${founderClaimable.toFixed(4)} SOL of founder fees accrued. The agent claims creator fees into Loop custody; on-chain withdrawal to your creator wallet is being wired.`
                    : "Nothing to claim yet — fees accrue as the token trades."
              }
              className="mt-1 w-full font-display font-semibold text-[13.5px] py-[10px] rounded-[10px] border border-line-3 bg-surface-2 text-faint cursor-not-allowed"
            >
              {hasClaimable ? `Claim ${founderClaimable.toFixed(3)} SOL` : "Claim dev-fees"}
            </button>
            <p className="text-[11.5px] text-faint leading-[1.45]">
              The agent auto-claims creator fees on pump.fun; Loop custodies them
              and your founder share becomes claimable here.
              {preLaunch ? " 0 before launch." : ""}
            </p>
          </>
        ) : (
          <p className="text-[11.5px] text-faint leading-[1.45] border-t border-line-4 pt-[10px]">
            Creator fees route automatically per the split above. The founder
            share is claimable by the project&apos;s creator wallet; the agent
            share funds this project&apos;s own operations.
          </p>
        )}
      </div>
    </div>
  );
}

// One role's real swept-fee total (SOL), shown under the percentage chips once
// the fee_ledger has actual earnings.
function EarnedRow({ label, sol }: { label: string; sol: number }) {
  return (
    <div className="flex items-center justify-between font-mono text-[12px]">
      <span className="text-faint">{label}</span>
      <span className="text-body">{sol.toFixed(4)} SOL</span>
    </div>
  );
}

function SplitChip({
  label,
  pct,
  tone,
}: {
  label: string;
  pct: number;
  tone: "ink" | "accent" | "muted";
}) {
  const color =
    tone === "accent" ? "text-accent-text" : tone === "muted" ? "text-faint" : "text-ink";
  return (
    <div className="bg-surface-2 rounded-[9px] px-2 py-[7px] text-center">
      <div className={`font-mono font-semibold text-[13px] ${color}`}>{pct}%</div>
      <div className="text-[10.5px] text-faint mt-[1px]">{label}</div>
    </div>
  );
}

// Tiny SVG bar sparkline of recent on-chain treasury inflows (oldest → newest,
// left to right). Each bar is one claim, height ∝ its SOL amount. Decorative —
// the exact amounts live in the claim list below it.
function InflowSparkline({ amounts }: { amounts: number[] }) {
  const series = amounts.slice(0, 12).reverse(); // newest-first in → chronological
  const max = Math.max(...series, 0.000001);
  const W = 64;
  const H = 16;
  const gap = 1.5;
  const bw = (W - gap * (series.length - 1)) / series.length;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {series.map((v, i) => {
        const h = Math.max(1.5, (Math.max(0, v) / max) * H);
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={H - h}
            width={bw}
            height={h}
            rx={0.8}
            fill="var(--pos)"
            opacity={0.55 + (i / series.length) * 0.45}
          />
        );
      })}
    </svg>
  );
}

function TreasuryStats({
  project: p,
  solUsd,
  compute,
}: {
  project: Project;
  solUsd: number;
  compute?: ComputeSummary | null;
}) {
  // Poll the live on-chain balance + total $ value (SOL + the project token the
  // treasury holds — for LOOP that token value dwarfs the small SOL line) + the
  // real recent SOL inflows (claims).
  const { balance, tokenUi, valueUsd, tokenPriceUsd, claims, live } = useLiveTreasury(
    p.key,
    p.treasurySol
  );
  const { inspect } = useInspector();
  const sym = p.ticker.replace(/^\$/, "");
  const compact = (n: number) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(
      Math.max(0, n)
    );
  // Fall back to SOL-only value before the live read lands.
  const totalUsd = valueUsd || balance * solUsd;
  // Honest runway derived from the live balance + metered burn. Pre-launch shows
  // "pre-launch"; once launched, runway = balance / daily burn (days), or "—"
  // while burn isn't metered yet (burn 0 ⇒ no real spend to divide by). Never
  // the stale DB string on a live token.
  const burnPerDay = parseSolPerDay(p.burnPerDay);
  // Burn rate denominated in the PROJECT token (not SOL), at the live token price.
  const loopPerDay = tokenPriceUsd > 0 ? (burnPerDay * solUsd) / tokenPriceUsd : 0;
  const runwayLabel = !p.mint
    ? "pre-launch"
    : burnPerDay > 0
    ? `${Math.floor(balance / burnPerDay)}d`
    : "—";
  const rows: [string, React.ReactNode, boolean?][] = [
    // Balance led by $LOOP — the reserve the treasury actually holds — with the
    // small spendable SOL line below it.
    ...(tokenUi && tokenUi > 0
      ? ([[
          `${sym} balance`,
          <span key="loopbal" className="inline-flex items-center gap-[6px]">
            {live && (
              <span className="w-[6px] h-[6px] rounded-full bg-pos-bright animate-pulseFast" />
            )}
            {compact(tokenUi)} {sym}
          </span>,
        ]] as [string, React.ReactNode][])
      : []),
    ["SOL (ops)", `${balance.toFixed(2)} SOL`],
    ["Total earned", `${p.earnedSol.toFixed(2)} SOL`],
    [
      "Burn rate",
      tokenPriceUsd > 0 ? `${compact(loopPerDay)} ${sym}/day` : p.burnPerDay,
    ],
    ["Runway", runwayLabel, true],
  ];
  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="font-display font-semibold text-[14.5px] mb-3">
        Project Treasury
      </div>
      {/* Total value headline — SOL + token holdings, in $, so the treasury
          doesn't read as "tiny" from the SOL line alone. */}
      <div className="mb-3 pb-3 border-b border-line-4">
        <div className="text-[11px] text-faint">Total value</div>
        <div className="font-display font-bold text-[24px] tracking-[-0.02em] tabular-nums inline-flex items-center gap-[7px]">
          {live && (
            <span className="w-[7px] h-[7px] rounded-full bg-pos-bright animate-pulseFast" />
          )}
          ${usd(totalUsd)}
        </div>
        <div className="text-[11.5px] text-faint mt-[1px]">
          {balance.toFixed(2)} SOL
          {tokenUi && tokenUi > 0
            ? ` + ${Math.round(tokenUi).toLocaleString("en-US")} ${sym}`
            : ""}
        </div>
      </div>
      <div className="flex flex-col gap-[10px] text-[13px]">
        {rows.map(([label, value, pos]) => (
          <div key={String(label)} className="flex justify-between">
            <span className="text-muted">{label}</span>
            <span className={`font-mono ${pos ? "text-pos" : ""}`}>{value}</span>
          </div>
        ))}
        {claims.length > 0 && (
          <div className="border-t border-line-4 pt-[10px] flex flex-col gap-[8px]">
            <div className="flex items-center justify-between">
              <span className="text-muted text-[12px]">Recent claims · on-chain</span>
              {claims.length > 1 && (
                <InflowSparkline amounts={claims.map((c) => c.sol)} />
              )}
            </div>
            {claims.slice(0, 4).map((c) => (
              <button
                key={c.sig}
                onClick={() => inspect({ kind: "claim", claim: c })}
                title="Inspect this inflow"
                className="flex justify-between font-mono text-[12px] text-left hover:opacity-80 transition-opacity"
              >
                <span className="text-faint">{shortAge(Math.floor(Date.now() / 1000) - c.at)} ago</span>
                <span className="text-pos">+{c.sol.toFixed(3)} SOL</span>
              </button>
            ))}
          </div>
        )}
        <InfraCosts project={p} solUsd={solUsd} compute={compute} />
        <div className="flex justify-between border-t border-line-4 pt-[10px]">
          <span className="text-muted">Supply</span>
          <span className="font-mono">{p.supply}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Rewards → Loop</span>
          <span className="font-mono">5%</span>
        </div>
        <TreasuryExits />
        {(p.mint || p.treasuryWallet) && (
          <div className="flex flex-col gap-[10px] border-t border-line-4 pt-[10px]">
            {p.mint && (
              <div className="flex justify-between">
                <span className="text-muted">Mint</span>
                <a
                  href={explorerUrl(p.mint, p.network, p.chain)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-accent-text hover:text-accent-d transition-colors"
                >
                  {shortAddr(p.mint)} ↗
                </a>
              </div>
            )}
            {p.treasuryWallet && (
              <div className="flex justify-between">
                <span className="text-muted">Treasury</span>
                <a
                  href={explorerUrl(p.treasuryWallet, p.network, p.chain)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-accent-text hover:text-accent-d transition-colors"
                >
                  {shortAddr(p.treasuryWallet)} ↗
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// No-stuck-funds guarantee, made visible: the three governed exits a buyer
// should know about before sending SOL. Rendered from lib/governance.ts's
// TREASURY_EXITS so the UI and the runtime share one source of truth.
function TreasuryExits() {
  return (
    <div className="flex flex-col gap-[8px] border-t border-line-4 pt-[10px]">
      <div className="flex items-center justify-between">
        <span className="text-muted">Governed · no stuck funds</span>
        <span
          className="w-[6px] h-[6px] rounded-full bg-pos-bright"
          title="Treasury is a governed vault — SOL can always exit"
        />
      </div>
      {TREASURY_EXITS.map((e) => (
        <div key={e.kind} className="flex items-start gap-[7px]">
          <span
            className={`mt-[5px] w-[5px] h-[5px] rounded-[2px] flex-none ${
              e.needsVote ? "bg-accent" : "bg-pos"
            }`}
          />
          <div className="leading-[1.4]">
            <span className="text-body">{e.label}</span>
            {e.needsVote && (
              <span className="ml-[6px] font-mono text-[10.5px] text-accent-text">
                vote-gated
              </span>
            )}
            <div className="text-[11.5px] text-faint">{e.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Violet ramp (lightest = cheapest slice) so the allocation bar stays on-brand.
const INFRA_COLOR: Record<CostKey, string> = {
  compute: "oklch(0.47 0.21 285)",
  email: "oklch(0.58 0.18 285)",
  social: "oklch(0.68 0.13 285)",
  hosting: "oklch(0.78 0.08 285)",
};

// What the agent's daily burn actually pays for, itemised and tied to fees. The
// Compute line shows the REAL Claude API spend (Anthropic Admin Cost API) since
// launch when available — not a modeled estimate — and a remaining-credit line.
function InfraCosts({
  project: p,
  solUsd,
  compute,
}: {
  project: Project;
  solUsd: number;
  compute?: ComputeSummary | null;
}) {
  const infra = infraBreakdown(p, solUsd);
  const usdMo = (n: number) => "$" + Math.round(n).toLocaleString("en-US") + "/mo";
  const money = (n: number) =>
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: n < 100 ? 2 : 0,
      maximumFractionDigits: 2,
    });
  const sinceLabel = compute
    ? new Date(compute.sinceISO).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
  return (
    <div className="border-t border-line-4 pt-[12px]">
      <div className="flex items-center justify-between mb-[9px]">
        <span className="text-muted text-[13px]">Infra costs · funded by fees</span>
        <span className="font-mono text-[10.5px] text-accent-text bg-accent-tint px-[7px] py-[2px] rounded-[5px]">
          {infra.tier}
        </span>
      </div>
      <div className="flex h-[7px] rounded-full overflow-hidden mb-[10px]">
        {infra.items.map((i) => (
          <div
            key={i.key}
            style={{ width: `${i.share * 100}%`, background: INFRA_COLOR[i.key] }}
            title={`${i.label} · ${Math.round(i.share * 100)}% · ${usdMo(i.usdPerMonth)}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-[7px]">
        {infra.items.map((i) => {
          // Compute shows REAL cumulative Claude spend (cumulative "total"), not a
          // /mo estimate, when the Admin Cost API is wired; others stay modeled.
          const real = i.key === "compute" && compute;
          return (
            <div
              key={i.key}
              className="flex items-center justify-between gap-2"
              title={
                real
                  ? `Real Claude API spend since ${sinceLabel} (Anthropic Admin Cost API)`
                  : i.detail
              }
            >
              <span className="inline-flex items-center gap-[6px] min-w-0">
                <span
                  className="w-[7px] h-[7px] rounded-full flex-none"
                  style={{ background: INFRA_COLOR[i.key] }}
                />
                <span className="text-muted text-[12px] truncate">{i.label}</span>
              </span>
              <span className="font-mono text-[11.5px] text-ink whitespace-nowrap">
                {real ? (
                  <>
                    {money(compute!.spentUsd)}{" "}
                    <span className="text-faint text-[10px]">total</span>
                  </>
                ) : (
                  usdMo(i.usdPerMonth)
                )}
              </span>
            </div>
          );
        })}
      </div>
      {/* Real Claude API ledger: cumulative spend since launch + remaining credit
          (a configured starting credit − measured spend). Only when wired. */}
      {compute && (
        <div className="mt-[10px] flex items-center justify-between gap-2 rounded-[8px] border border-line-4 bg-surface-2 px-3 py-2">
          <span className="text-muted text-[12px]">Claude API · since {sinceLabel}</span>
          <span className="font-mono text-[11.5px] whitespace-nowrap">
            <span className="text-ink">{money(compute.spentUsd)} spent</span>
            {compute.remainingUsd != null && (
              <>
                {" · "}
                <span className="text-pos">{money(compute.remainingUsd)} left</span>
              </>
            )}
          </span>
        </div>
      )}

      {/* The REAL carnet de comptes — only LOOP itself carries named bills the
          platform actually pays. Other projects show the modeled bar above. */}
      {p.official && <ExpenseLedger project={p} solUsd={solUsd} compute={compute} />}

      <div className="text-[11px] text-faint mt-[10px] leading-[1.5]">
        Trading fees + creator rewards top up the treasury — no payroll, the agent
        pays its own bills while it&apos;s funded.
      </div>
    </div>
  );
}

// The real expense ledger: named bills (Claude metered + the fixed subscriptions
// and one-offs from lib/ledger.ts), rolled up into spend-to-date, monthly burn,
// and treasury runway. This is the honest accounting view — past AND projected.
const CADENCE_LABEL: Record<Cadence, string> = {
  metered: "metered",
  monthly: "/mo",
  once: "one-off",
};

function ExpenseLedger({
  project: p,
  solUsd,
  compute,
}: {
  project: Project;
  solUsd: number;
  compute?: ComputeSummary | null;
}) {
  const entries: LedgerEntry[] = withCompute(loopLedger(), compute?.spentUsd ?? null);
  const sum = ledgerSummary(entries);
  // Runway uses spendable SOL only — illiquid treasury-held tokens are never
  // folded into the buffer (mirrors the treasury card's rule).
  const treasuryUsd = (p.treasurySol ?? 0) * solUsd;
  const runway = runwayMonths(treasuryUsd, sum.projectedMonthlyUsd);
  const money = (n: number) =>
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: n > 0 && n < 100 ? 2 : 0,
      maximumFractionDigits: n < 100 ? 2 : 0,
    });
  const runwayLabel = !Number.isFinite(runway)
    ? "∞"
    : runway >= 12
      ? `${(runway / 12).toFixed(1)}y`
      : `${runway.toFixed(runway < 2 ? 1 : 0)}mo`;

  return (
    <div className="mt-[12px] rounded-[10px] border border-line-4 bg-surface-2 px-3 py-[11px]">
      <div className="flex items-center justify-between mb-[8px]">
        <span className="text-muted text-[12px] font-medium">Ledger · real bills</span>
        <span className="font-mono text-[10px] text-faint">USD</span>
      </div>

      <div className="flex flex-col gap-[6px]">
        {entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2" title={e.note}>
            <span className="inline-flex items-center gap-[6px] min-w-0">
              <span className="text-muted text-[12px] truncate">{e.label}</span>
              <span className="font-mono text-[9.5px] text-faint border border-line-4 rounded-[4px] px-[4px] py-[1px] flex-none">
                {CADENCE_LABEL[e.cadence]}
              </span>
            </span>
            <span className="font-mono text-[11.5px] text-ink whitespace-nowrap">
              {e.cadence === "metered" && (compute?.spentUsd ?? 0) === 0 ? (
                <span className="text-faint">—</span>
              ) : (
                money(e.usd)
              )}
              {e.currency === "USDC" && <span className="text-faint text-[9.5px]"> USDC</span>}
            </span>
          </div>
        ))}
      </div>

      {/* Roll-up: spent-to-date · forward monthly burn · runway off the treasury */}
      <div className="grid grid-cols-3 gap-2 mt-[10px] pt-[9px] border-t border-line-4">
        <LedgerStat label="Spent to date" value={money(sum.spentToDateUsd)} />
        <LedgerStat label="Burn / mo" value={money(sum.projectedMonthlyUsd)} />
        <LedgerStat
          label="Runway"
          value={runwayLabel}
          tone={Number.isFinite(runway) && runway < 1 ? "warn" : "pos"}
        />
      </div>
    </div>
  );
}

function LedgerStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "warn";
}) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-faint text-[10px]">{label}</span>
      <span
        className={`font-mono text-[12.5px] ${
          tone === "warn" ? "text-warn" : tone === "pos" ? "text-pos" : "text-ink"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function TopHolders({
  holders,
  network,
  preLaunch,
}: {
  holders: Holder[];
  network: "mainnet" | "devnet";
  preLaunch?: boolean;
}) {
  const { inspect } = useInspector();
  // Concentration of the shown top holders — the fraction of supply they hold
  // combined. A quick read on how distributed (or whale-heavy) the token is.
  const topShare = holders.reduce((s, h) => s + Math.max(0, h.share), 0);
  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="font-display font-semibold text-[14.5px] mb-3">Top Holders</div>
      {preLaunch || holders.length === 0 ? (
        <div className="text-[12.5px] text-faint py-2">
          {preLaunch
            ? "No holders yet — the holder list appears once the token is minted and trading begins."
            : "Holder data is loading…"}
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {/* Concentration summary + distribution bar (top holders vs the rest). */}
          <div className="mb-1">
            <div className="flex items-baseline justify-between mb-[7px]">
              <span className="text-[12px] text-muted">
                Top {holders.length} concentration
              </span>
              <span className="font-mono text-[12.5px] tabular-nums">
                {(topShare * 100).toFixed(1)}%
              </span>
            </div>
            <div
              className="flex h-[7px] rounded-full overflow-hidden bg-[#F0EEF3]"
              title={`Top ${holders.length} hold ${(topShare * 100).toFixed(1)}% of supply`}
            >
              {holders.map((h, i) => (
                <div
                  key={h.address}
                  style={{
                    width: `${Math.max(0, h.share) * 100}%`,
                    background: `oklch(${0.47 + i * 0.03} 0.21 285)`,
                  }}
                />
              ))}
            </div>
          </div>
          {holders.map((h) => (
            <button
              key={h.address}
              onClick={() => inspect({ kind: "holder", holder: h })}
              title="Inspect this holder"
              className="flex items-center justify-between gap-2 font-mono text-[12.5px] w-full text-left hover:opacity-80 transition-opacity"
            >
              <span className="flex items-center gap-[8px] min-w-0">
                {/* Loop profile identity (name + avatar) when the holder set one;
                    else a .sol name; else the short address. A configured profile
                    also gets the accent-tinted "loop" cue so it stands out. */}
                {h.loopAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={h.loopAvatar} alt="" className="w-[20px] h-[20px] rounded-[6px] object-cover border border-line-2 flex-none" />
                ) : h.loopName ? (
                  <span className="w-[20px] h-[20px] rounded-[6px] bg-accent-tint border border-accent-tint-border flex items-center justify-center text-[10px] font-display font-bold text-accent-text flex-none">
                    {h.loopName.slice(0, 1).toUpperCase()}
                  </span>
                ) : null}
                {h.loopName ? (
                  <span className="text-ink truncate">{h.loopName}</span>
                ) : h.name ? (
                  <span className="text-ink truncate">{h.name}</span>
                ) : (
                  <span className="text-muted truncate">{shortAddr(h.address)}</span>
                )}
              </span>
              <span className="tabular-nums flex-none">{(h.share * 100).toFixed(2)}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
