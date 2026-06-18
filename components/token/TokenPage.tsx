"use client";

import Link from "next/link";
import { useState } from "react";
import { LoopMark } from "../LoopMark";
import { NetworkToggle } from "../NetworkToggle";
import { Chart } from "./Chart";
import { useWallet } from "@/lib/wallet";
import { useNetwork } from "@/lib/network";
import { useLiveMarket, type Timeframe } from "@/lib/useLiveMarket";
import { useLiveTreasury } from "@/lib/useLiveTreasury";
import { buildSwapTx } from "@/lib/pump";
import { AgentConsole } from "./AgentConsole";
import { AgentOperator } from "./AgentOperator";
import { ProjectWallet } from "./ProjectWallet";
import type { AgentState } from "@/lib/agent-data";
import type { Candle, Holder, MarketStats, Project, Trade } from "@/lib/types";
import { fmtPrice, shortAge, explorerUrl, explorerTx, shortAddr } from "@/lib/format";
import { infraBreakdown, parseSolPerDay, type CostKey } from "@/lib/economics";
import { agentRunState, canAffordTick } from "@/lib/budget";
import { splitForProject } from "@/lib/fees";
import { claimable, ZERO_TOTALS } from "@/lib/fee-ledger";
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
  agentState,
}: {
  project: Project;
  market: LiveMarket;
  agentSol?: number | null;
  solUsd: number;
  commits: { hash: string; msg: string }[];
  agentState?: AgentState;
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

  return (
    <>
      <TokenNav ticker={p.ticker} walletLabel={wallet.label} connected={wallet.connected} onToggle={wallet.toggle} />

      <main>
      {/* Header */}
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
            <HeaderStat label="Market Cap" value={p.marketCap} />
            <HeaderStat label="Liquidity" value={p.liquidity} />
            <HeaderStat label="Holders" value={p.holders} />
            <HeaderStat label="24h Volume" value={p.volume24h} />
          </div>
        </div>
      </section>

      {/* Main grid */}
      <section className="max-w-[1280px] mx-auto px-8 pb-5 grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-4 items-start">
        {/* Left column */}
        <div className="flex flex-col gap-4">
          {/* Agent Console — steer the project's AI */}
          <AgentConsole
            project={p}
            directives={agentState?.directives}
            screened={agentState?.screenedDirectives}
          />
          {/* Agent Operator — what the agent does autonomously (tasks/inbox/social) */}
          <AgentOperator
            project={p}
            tasks={agentState?.tasks}
            inbox={agentState?.inbox}
            social={agentState?.social}
          />
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

          {/* Agent activity */}
          <div className="bg-ink rounded-[16px] px-6 py-5 font-mono">
            <div className="flex items-center justify-between mb-[14px]">
              <div className="flex items-center gap-[10px]">
                <span className="w-2 h-2 rounded-full bg-accent-400 animate-pulseFast" />
                <span className="text-[12.5px] text-canvas">
                  loop-engine · agent {p.ticker}
                </span>
              </div>
              <span className="text-[11.5px] text-muted">{p.repo}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="flex flex-col gap-[7px]">
                <div className="text-[11px] text-muted mb-[2px]">LATEST COMMITS</div>
                {commitFeed.length === 0 ? (
                  <div className="text-[12.5px] text-muted">No commits yet.</div>
                ) : (
                  commitFeed.map((c) => (
                    <div key={c.hash} className="text-[12.5px] text-[#B7B2BE]">
                      <span className="text-accent-400">{c.hash}</span> {c.msg}
                    </div>
                  ))
                )}
              </div>
              <div className="flex flex-col gap-[7px]">
                <div className="text-[11px] text-muted mb-[2px]">LIVE LOG</div>
                <div className="text-[12.5px] text-muted">
                  Agent starts logging once it runs.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          <SwapCard project={p} lastPrice={last} solUsd={solUsd} preLaunch={preLaunch} />
          <BondingCurve curve={p.curve} />
          <TreasuryStats project={p} solUsd={solUsd} />
          <FeesCustodyCard project={p} preLaunch={preLaunch} />
          <FundCard project={p} />
          <TopHolders holders={market.holders} network={p.network ?? "mainnet"} preLaunch={preLaunch} />

        </div>
      </section>
      </main>

      <footer className="border-t border-line py-[22px] px-8 max-w-[1280px] mx-auto flex items-center justify-between">
        <span className="text-[12.5px] text-faint">© 2026 Loop · {p.network ?? "mainnet"}</span>
        <span className="font-mono text-[12px] text-pos">● All systems operational</span>
      </footer>
    </>
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
        <NetworkToggle className="hidden sm:flex" />
        <ShareButton />
        <Link
          href="/"
          className="hidden sm:inline-block text-[13.5px] text-muted hover:text-ink transition-colors px-[14px] py-[9px]"
        >
          ← All projects
        </Link>
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

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-faint mb-[3px]">{label}</div>
      <div className="font-mono text-[14px]">{value}</div>
    </div>
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

      <label className="block text-[12px] text-muted mb-[6px]">
        {buy ? "Amount in SOL" : `Amount in ${sym}`}
      </label>
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

function BondingCurve({ curve }: { curve: number }) {
  const graduated = curve >= 1;
  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="flex justify-between items-baseline mb-[10px]">
        <span className="font-display font-semibold text-[14.5px]">Bonding Curve</span>
        <span className="font-mono text-[12.5px] text-accent-text">
          {graduated ? "graduated" : `${Math.round(curve * 100)}%`}
        </span>
      </div>
      <div className="h-[10px] rounded-full bg-[#F0EEF3] overflow-hidden mb-[10px]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,oklch(0.62_0.15_285),oklch(0.47_0.21_285))]"
          style={{ width: `${Math.min(100, Math.round(curve * 100))}%` }}
        />
      </div>
      <div className="text-[12px] text-muted leading-[1.5]">
        {graduated
          ? "Curve complete — liquidity migrated to Raydium. Trading is fully open."
          : "Graduates to Raydium at $69K market cap. Every buy moves the curve forward."}
      </div>
    </div>
  );
}

function FeesCustodyCard({
  project: p,
  preLaunch,
}: {
  project: Project;
  preLaunch: boolean;
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
  // No fees can have accrued before launch; once the ledger table is live this
  // reads the project's real swept-and-unclaimed founder balance. Honest 0 now.
  const founderClaimable = claimable(ZERO_TOTALS, ZERO_TOTALS).founderSol;
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

        {/* Agent wallet (external custody) */}
        <div className="flex justify-between border-t border-line-4 pt-[10px]">
          <span className="text-muted">Agent wallet</span>
          {p.agentWallet ? (
            <a
              href={explorerUrl(p.agentWallet, net)}
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
                  : "Nothing to claim yet — fees accrue as the token trades."
              }
              className="mt-1 w-full font-display font-semibold text-[13.5px] py-[10px] rounded-[10px] border border-line-3 bg-surface-2 text-faint cursor-not-allowed"
            >
              Claim dev-fees
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

function TreasuryStats({ project: p, solUsd }: { project: Project; solUsd: number }) {
  // Poll the live on-chain balance (real when the project has a treasury_wallet).
  const { balance, live } = useLiveTreasury(p.key, p.treasurySol);
  // Honest runway derived from the live balance + metered burn. Pre-launch shows
  // "pre-launch"; once launched, runway = balance / daily burn (days), or "—"
  // while burn isn't metered yet (burn 0 ⇒ no real spend to divide by). Never
  // the stale DB string on a live token.
  const burnPerDay = parseSolPerDay(p.burnPerDay);
  const runwayLabel = !p.mint
    ? "pre-launch"
    : burnPerDay > 0
    ? `${Math.floor(balance / burnPerDay)}d`
    : "—";
  const rows: [string, React.ReactNode, boolean?][] = [
    [
      "Balance",
      <span key="bal" className="inline-flex items-center gap-[6px]">
        {live && (
          <span className="w-[6px] h-[6px] rounded-full bg-pos-bright animate-pulseFast" />
        )}
        {balance.toFixed(2)} SOL
      </span>,
    ],
    ["Total earned", `${p.earnedSol.toFixed(2)} SOL`],
    ["Burn rate", p.burnPerDay],
    ["Runway", runwayLabel, true],
  ];
  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="font-display font-semibold text-[14.5px] mb-3">
        Project Treasury
      </div>
      <div className="flex flex-col gap-[10px] text-[13px]">
        {rows.map(([label, value, pos]) => (
          <div key={String(label)} className="flex justify-between">
            <span className="text-muted">{label}</span>
            <span className={`font-mono ${pos ? "text-pos" : ""}`}>{value}</span>
          </div>
        ))}
        <InfraCosts project={p} solUsd={solUsd} />
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
                  href={explorerUrl(p.mint, p.network)}
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
                  href={explorerUrl(p.treasuryWallet, p.network)}
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

// Donate SOL straight to a project's on-chain treasury. Real transfer only:
// the button is disabled until the project has a treasury_wallet, and guards
// that the active cluster matches the project's before sending.
function FundCard({ project: p }: { project: Project }) {
  const wallet = useWallet();
  const { network, setNetwork } = useNetwork();
  const projectNet = p.network ?? "mainnet";
  const hasTreasury = !!p.treasuryWallet;
  const wrongNet = hasTreasury && network !== projectNet;

  const [amt, setAmt] = useState("0.5");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle"
  );
  const [sig, setSig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const amtN = parseFloat(amt) || 0;
  const valid = amtN > 0;
  const quicks = ["0.1", "0.5", "1", "5"];

  const onFund = async () => {
    if (!wallet.connected) {
      wallet.connect();
      return;
    }
    if (!p.treasuryWallet || wrongNet || !valid || status === "sending") return;
    setStatus("sending");
    setErr(null);
    setSig(null);
    try {
      const s = await wallet.sendSol(p.treasuryWallet, amtN);
      setSig(s);
      setStatus("done");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      setErr(/reject|denied|cancel/i.test(msg) ? "Cancelled in wallet" : msg);
      setStatus("error");
    }
  };

  const label = !wallet.connected
    ? "Connect Wallet"
    : status === "sending"
    ? "Confirm in wallet…"
    : !valid
    ? "Enter an amount"
    : `Fund ${amtN} SOL`;

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="flex items-center justify-between mb-1">
        <span className="font-display font-semibold text-[14.5px]">
          Fund this project
        </span>
        <span className="font-mono text-[10.5px] text-accent-text bg-accent-tint px-[7px] py-[2px] rounded-[5px]">
          {projectNet}
        </span>
      </div>
      <p className="text-[12px] text-muted leading-[1.5] mb-3">
        Donate SOL straight to the treasury — it extends the runway and pays the
        agent&apos;s infra bills. No tokens minted, no strings.
      </p>

      {!hasTreasury ? (
        <div className="text-[12px] text-faint bg-surface-2 rounded-[10px] px-3 py-[10px]">
          No on-chain treasury wallet yet. Donations open once this project
          launches on-chain.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border border-line-3 rounded-[10px] p-1 pl-[14px] mb-[10px]">
            <input
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              inputMode="decimal"
              aria-label="Donation amount in SOL"
              className="flex-1 border-0 outline-none font-mono text-[16px] py-2 bg-transparent min-w-0"
            />
            <span className="font-mono text-[12px] text-faint px-[10px] py-2 bg-surface-3 rounded-[7px]">
              SOL
            </span>
          </div>
          <div className="grid grid-cols-4 gap-[6px] mb-3">
            {quicks.map((v) => (
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
              className="w-full font-display font-semibold text-[14px] py-[12px] rounded-[11px] border border-warn text-warn"
            >
              Switch to {projectNet} to fund
            </button>
          ) : (
            <button
              onClick={onFund}
              disabled={status === "sending" || (wallet.connected && !valid)}
              className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[11px] text-white transition-opacity disabled:opacity-60"
              style={{ background: wallet.connected ? "var(--accent)" : "#16131A" }}
            >
              {label}
            </button>
          )}

          <div className="mt-[10px] flex items-center justify-between font-mono text-[11px] text-faint">
            <span>To treasury</span>
            <a
              href={explorerUrl(p.treasuryWallet!, projectNet)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-text hover:text-accent-d transition-colors"
            >
              {shortAddr(p.treasuryWallet!)} ↗
            </a>
          </div>

          {status === "done" && sig && (
            <a
              href={explorerTx(sig, projectNet)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-[10px] block font-mono text-[11.5px] text-pos bg-[oklch(0.97_0.03_150)] border border-[oklch(0.9_0.06_150)] rounded-[8px] px-3 py-[9px] animate-fadeIn"
            >
              ✓ Donation sent · {shortAddr(sig)} ↗
            </a>
          )}
          {status === "error" && err && (
            <div className="mt-[10px] font-mono text-[11.5px] text-neg bg-[oklch(0.97_0.03_25)] border border-[oklch(0.9_0.06_25)] rounded-[8px] px-3 py-[9px] animate-fadeIn">
              {err}
            </div>
          )}
        </>
      )}
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

// What the agent's daily burn actually pays for, itemised and tied to fees.
function InfraCosts({ project: p, solUsd }: { project: Project; solUsd: number }) {
  const infra = infraBreakdown(p, solUsd);
  const usdMo = (n: number) => "$" + Math.round(n).toLocaleString("en-US") + "/mo";
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
        {infra.items.map((i) => (
          <div
            key={i.key}
            className="flex items-center justify-between gap-2"
            title={i.detail}
          >
            <span className="inline-flex items-center gap-[6px] min-w-0">
              <span
                className="w-[7px] h-[7px] rounded-full flex-none"
                style={{ background: INFRA_COLOR[i.key] }}
              />
              <span className="text-muted text-[12px] truncate">{i.label}</span>
            </span>
            <span className="font-mono text-[11.5px] text-ink whitespace-nowrap">
              {usdMo(i.usdPerMonth)}
            </span>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-faint mt-[10px] leading-[1.5]">
        Trading fees + creator rewards top up the treasury — no payroll, the agent
        pays its own bills while it&apos;s funded.
      </div>
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
          {holders.map((h) => (
            <div
              key={h.address}
              className="flex items-center justify-between font-mono text-[12.5px]"
            >
              <a
                href={explorerUrl(h.address, network)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-accent-text transition-colors"
                title={h.name ? h.address : undefined}
              >
                {h.name ? (
                  <span className="text-ink">{h.name}</span>
                ) : (
                  shortAddr(h.address)
                )}
              </a>
              <span className="tabular-nums">{(h.share * 100).toFixed(2)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
