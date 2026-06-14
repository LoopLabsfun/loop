"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LoopMark } from "../LoopMark";
import { NetworkToggle } from "../NetworkToggle";
import { Chart } from "./Chart";
import { useWallet } from "@/lib/wallet";
import { useTokenMarket, type Timeframe } from "@/lib/useTokenMarket";
import { useLiveTreasury } from "@/lib/useLiveTreasury";
import type { Project } from "@/lib/types";
import { fmtPrice, shortAge } from "@/lib/format";

const TOP_HOLDERS = [
  { addr: "7xKq…g4fR", pct: "20.0%", tag: "treasury" },
  { addr: "3mQz…r8Lk", pct: "6.2%", tag: "curve" },
  { addr: "Hv9c…2dWp", pct: "4.8%", tag: "whale" },
  { addr: "Bn4t…9xQa", pct: "3.1%", tag: "whale" },
  { addr: "Kp2w…5mRv", pct: "2.4%", tag: "early" },
];

const COMMITS = [
  { hash: "8f3a21c", msg: "feat: add project dashboard" },
  { hash: "c2d9e07", msg: "fix: treasury balance sync" },
  { hash: "41b7aa9", msg: "feat: auto-claim system" },
  { hash: "e90c512", msg: "chore: optimize agent loop" },
];

export function TokenPage({
  project: p,
  solUsd,
  commits,
}: {
  project: Project;
  solUsd: number;
  commits: { hash: string; msg: string }[];
}) {
  // Live commits from the repo when available; otherwise the static sample.
  const commitFeed = commits.length > 0 ? commits : COMMITS;
  const wallet = useWallet();
  const { tf, mode, candles, trades, agentLog, changeTf, setMode } =
    useTokenMarket(p);

  const last = candles[candles.length - 1].c;
  const first = candles[0].o;
  const change = (last / first - 1) * 100;

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
              <span className="font-mono text-[11.5px] text-pos">● agent active</span>
            </div>
            <p className="text-[13.5px] text-muted mt-[5px] mb-0">{p.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-7">
          <div>
            <div className="font-display font-bold text-[32px] tracking-[-0.02em] tabular-nums">
              {fmtPrice(last)}
            </div>
            <div
              className="font-mono text-[13px]"
              style={{ color: change >= 0 ? "var(--pos)" : "var(--neg)" }}
            >
              {(change >= 0 ? "+" : "") + change.toFixed(2)}% · 24h
            </div>
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
          {/* Chart */}
          <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-[18px]">
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
                {tf === "1H" ? "last 48 min" : tf === "4H" ? "last 3.2 hours" : "last 48 hours"}
              </span>
              <span className="inline-flex items-center gap-[6px]">
                <span className="w-[6px] h-[6px] rounded-full bg-pos-bright animate-pulseFast" />
                live · updates every 2s
              </span>
            </div>
          </div>

          {/* Trades */}
          <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-[18px]">
            <div className="flex items-center justify-between mb-3">
              <span className="font-display font-semibold text-[15px]">Recent Trades</span>
              <span className="font-mono text-[11px] text-faint">
                {(1240 + trades.length).toLocaleString("en-US")} trades · 24h
              </span>
            </div>
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
                {commitFeed.map((c) => (
                  <div key={c.hash} className="text-[12.5px] text-[#B7B2BE]">
                    <span className="text-accent-400">{c.hash}</span> {c.msg}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-[7px]">
                <div className="text-[11px] text-muted mb-[2px]">LIVE LOG</div>
                {agentLog.map((l, i) => (
                  <div key={i} className="text-[12.5px] text-[#B7B2BE] animate-fadeInFast">
                    <span className="text-accent-400">{l.t}</span> {l.msg}
                  </div>
                ))}
                <div className="text-[12.5px] text-muted">
                  <span className="animate-pulseTick">▮</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          <SwapCard project={p} lastPrice={last} solUsd={solUsd} />
          <BondingCurve curve={p.curve} />
          <TreasuryStats project={p} />
          <TopHolders />

        </div>
      </section>
      </main>

      <footer className="border-t border-line py-[22px] px-8 max-w-[1280px] mx-auto flex items-center justify-between">
        <span className="text-[12.5px] text-faint">© 2026 Loop · simulated market data</span>
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

function SwapCard({ project: p, lastPrice, solUsd }: { project: Project; lastPrice: number; solUsd: number }) {
  const wallet = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState("1.0");
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const sym = p.ticker.slice(1);
  const buy = side === "buy";
  const amtN = parseFloat(amt) || 0;

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const est = buy
    ? Math.round((amtN * solUsd) / lastPrice).toLocaleString("en-US") + " " + sym
    : ((amtN * lastPrice) / solUsd).toFixed(3) + " SOL";

  const quicks: [string, string][] = buy
    ? [["0.1", "0.1"], ["0.5", "0.5"], ["1", "1"], ["5", "5"]]
    : [["1000", "1K"], ["10000", "10K"], ["100000", "100K"], ["500000", "500K"]];

  const doSwap = () => {
    if (!wallet.connected) {
      wallet.connect();
      return;
    }
    setToast(
      "tx confirmed · " +
        (buy ? `${amt} SOL → ${est}` : `${amt} ${sym} → ${est}`)
    );
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
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

      <button
        onClick={doSwap}
        className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[11px] text-white"
        style={{
          background: wallet.connected
            ? buy
              ? "oklch(0.55 0.15 150)"
              : "oklch(0.55 0.17 25)"
            : "#16131A",
        }}
      >
        {wallet.connected ? (buy ? `Buy ${p.ticker}` : `Sell ${p.ticker}`) : "Connect Wallet"}
      </button>

      {toast && (
        <div className="mt-[10px] font-mono text-[11.5px] text-pos bg-[oklch(0.97_0.03_150)] border border-[oklch(0.9_0.06_150)] rounded-[8px] px-3 py-[9px] animate-fadeIn">
          {toast}
        </div>
      )}
      <div className="mt-[10px] text-[11px] text-faint text-center">
        1% of every trade funds the project treasury
      </div>
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

function TreasuryStats({ project: p }: { project: Project }) {
  // Poll the live on-chain balance (real when the project has a treasury_wallet).
  const { balance, live } = useLiveTreasury(p.key, p.treasurySol);
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
    ["Runway", p.runway, true],
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
        <div className="flex justify-between border-t border-line-4 pt-[10px]">
          <span className="text-muted">Supply</span>
          <span className="font-mono">{p.supply}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">LOOP staked</span>
          <span className="font-mono">1,000 · locked</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Rewards → Loop</span>
          <span className="font-mono">5%</span>
        </div>
      </div>
    </div>
  );
}

function TopHolders() {
  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="font-display font-semibold text-[14.5px] mb-3">Top Holders</div>
      <div className="flex flex-col gap-[10px]">
        {TOP_HOLDERS.map((h) => (
          <div
            key={h.addr}
            className="flex items-center justify-between font-mono text-[12.5px]"
          >
            <span className="text-muted">{h.addr}</span>
            <span className="inline-flex items-center gap-2">
              <span className="text-[10.5px] text-accent-text bg-accent-tint px-[7px] py-[2px] rounded-[5px]">
                {h.tag}
              </span>
              {h.pct}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
