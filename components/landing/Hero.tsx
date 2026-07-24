import { LoopMarkAnimated } from "../LoopMark";
import { HoodMark } from "../HoodMark";
import { useChain } from "@/lib/chains/chain-context";
import type { LoopEngineState } from "@/lib/useLoopEngine";
import type { Network } from "@/lib/types";
import type { AgentTask } from "@/lib/agent";
import type { XStockHolding } from "@/lib/xstocks-holdings";
import { compactNum, sol, usd } from "@/lib/format";

export function Hero({
  engine,
  solUsd,
  launched,
  network,
  ticker,
  treasuryToken,
  treasuryTokenUsd,
  treasuryHistory,
  treasuryHoldings,
  agentActive,
  currentTask,
  shippedCount,
  onLaunch,
  onScroll,
}: {
  engine: LoopEngineState;
  solUsd: number;
  launched: boolean;
  network?: Network;
  ticker?: string;
  treasuryToken?: number;
  treasuryTokenUsd?: number;
  treasuryHistory?: { t: number; sol: number }[];
  /** Live xStocks positions held by the treasury wallet. */
  treasuryHoldings?: XStockHolding[];
  agentActive?: boolean;
  currentTask?: AgentTask;
  /** Cumulative count of shipped tasks — shown as social proof below the CTA buttons. */
  shippedCount?: number;
  onLaunch: () => void;
  onScroll: (id: string) => void;
}) {
  return (
    <section className="max-w-[1200px] mx-auto px-10 pt-14 pb-10">
      <div>
        <div className="inline-flex items-center gap-[13px] mb-[26px]">
          <span className="h-px w-8 bg-accent" />
          <span className="font-mono text-[12px] font-medium tracking-[0.16em] uppercase text-accent-text">
            Fund an agent. It builds the rest.
          </span>
        </div>
        <h1 className="font-display font-bold uppercase tracking-[-0.04em] leading-[0.98] m-0 mb-[14px] text-[clamp(60px,7.4vw,96px)]">
          Ideas trade.
          <br />
          <span className="inline-flex items-center gap-[26px]">
            AI builds.
            <LoopMarkAnimated />
          </span>
          <br />
          <span className="text-accent">Loop never stops.</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_0.92fr] gap-12 items-start mt-7">
        <div>
          <p className="text-[18px] leading-[1.55] text-muted m-0 mb-3 max-w-[470px] [text-wrap:pretty]">
            Every project gets a token, an on-chain treasury, and an AI agent
            that runs it — shipping code, running outreach, answering its own
            inbox. Trading fills the treasury; the agent works while it&apos;s
            funded.
          </p>
          <p className="font-mono text-[13px] text-faint m-0 mb-5 max-w-[470px] [text-wrap:pretty]">
            Loop is project&nbsp;#0 — funded by its own token, built by its own
            agent, shipping in public.
          </p>
          <p className="font-display font-semibold text-[17px] m-0 mb-8">
            Launch a <span className="text-accent">token</span>. Fund an{" "}
            <span className="text-accent">AI</span>. It runs the rest.
          </p>
          <div className="flex gap-3 mb-3">
            <button
              onClick={onLaunch}
              className="font-display font-semibold text-[15px] px-6 py-[13px] rounded-[12px] bg-accent text-white hover:bg-accent-d transition-colors"
            >
              Launch a Project
            </button>
            <button
              onClick={() => onScroll("loop-projects")}
              className="font-display font-semibold text-[15px] px-6 py-[13px] rounded-[12px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors"
            >
              View Live Projects
            </button>
          </div>
          {shippedCount != null && shippedCount > 0 && (
            <p className="font-mono text-[12px] text-faint m-0 mb-6">
              ✓ {shippedCount} tasks shipped by the agent
            </p>
          )}
          <BuiltOn />
        </div>

        <TreasuryCard
          engine={engine}
          solUsd={solUsd}
          launched={launched}
          network={network}
          ticker={ticker}
          treasuryToken={treasuryToken}
          treasuryTokenUsd={treasuryTokenUsd}
          treasuryHistory={treasuryHistory}
          treasuryHoldings={treasuryHoldings}
          agentActive={agentActive}
          currentTask={currentTask}
        />
      </div>
    </section>
  );
}

// The "Built on" strip follows the header's chain switch: Solana + Pump.fun in
// Solana mode, the Robinhood Chain lockup in Hood mode — never both at once.
function BuiltOn() {
  const { chain } = useChain();
  return (
    <div className="flex items-center gap-[18px] text-[13px] text-faint">
      <span>Built on</span>
      {chain === "hood" ? (
        <>
          <RobinhoodLogo />
          <PonsLogo />
        </>
      ) : (
        <>
          <SolanaLogo />
          <PumpFunLogo />
        </>
      )}
    </div>
  );
}

function RobinhoodLogo() {
  return (
    <span
      className="inline-flex items-center gap-[7px]"
      role="img"
      aria-label="Robinhood Chain"
    >
      <HoodMark size={17} />
      <span className="font-display font-bold text-[15px] tracking-[-0.02em] text-ink">
        Robinhood Chain
      </span>
    </span>
  );
}

function PonsLogo() {
  return (
    <span
      className="inline-flex items-center gap-[6px]"
      role="img"
      aria-label="Pons"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/pons.png" alt="" className="h-[17px] w-[17px] object-contain" />
      <span
        className="font-normal text-[15px] tracking-normal text-ink leading-none"
        style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
      >
        pons
      </span>
    </span>
  );
}

function SolanaLogo() {
  // Three slanted bars + wordmark. Gradient is Solana's purple→green brand ramp.
  return (
    <svg
      viewBox="0 0 118 36"
      className="h-[20px] w-auto"
      role="img"
      aria-label="Solana"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Solana</title>
      <defs>
        <linearGradient id="sol-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <g fill="url(#sol-grad)">
        <path d="M8 9 H33 L27 14 H2 Z" />
        <path d="M8 16 H33 L27 21 H2 Z" />
        <path d="M8 23 H33 L27 28 H2 Z" />
      </g>
      <text
        x="42"
        y="25"
        fontFamily="'Space Grotesk', system-ui, sans-serif"
        fontSize="20"
        fontWeight="700"
        letterSpacing="-0.5"
        fill="var(--ink)"
      >
        Solana
      </text>
    </svg>
  );
}

function PumpFunLogo() {
  return (
    <svg
      viewBox="0 0 132 36"
      className="h-[20px] w-auto"
      role="img"
      aria-label="Pump.fun"
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>Pump.fun</title>
      <defs>
        <clipPath id="pf-pill">
          <rect x="4" y="11" width="28" height="14" rx="7" />
        </clipPath>
      </defs>
      <g transform="rotate(-38 18 18)">
        <g clipPath="url(#pf-pill)">
          <rect x="4" y="11" width="14" height="14" fill="#bdecca" />
          <rect x="18" y="11" width="14" height="14" fill="#3fbf6e" />
        </g>
        <rect
          x="4"
          y="11"
          width="28"
          height="14"
          rx="7"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="2.6"
        />
        <line x1="18" y1="11" x2="18" y2="25" stroke="var(--ink)" strokeWidth="2.6" />
        <line
          x1="8.5"
          y1="15"
          x2="11.5"
          y2="15"
          stroke="var(--ink)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.45"
        />
        <line
          x1="8.5"
          y1="21"
          x2="11.5"
          y2="21"
          stroke="var(--ink)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.45"
        />
      </g>
      <text
        x="41"
        y="25"
        fontFamily="'Space Grotesk', system-ui, sans-serif"
        fontSize="20"
        fontWeight="700"
        letterSpacing="-0.5"
        fill="var(--ink)"
      >
        Pump<tspan fill="#3cc46a">.</tspan>fun
      </text>
    </svg>
  );
}

function TreasuryCard({
  engine,
  solUsd,
  launched,
  network,
  ticker,
  treasuryToken,
  treasuryTokenUsd,
  treasuryHistory,
  treasuryHoldings,
  agentActive,
  currentTask,
}: {
  engine: LoopEngineState;
  solUsd: number;
  launched: boolean;
  network?: Network;
  ticker?: string;
  treasuryToken?: number;
  treasuryTokenUsd?: number;
  treasuryHistory?: { t: number; sol: number }[];
  treasuryHoldings?: XStockHolding[];
  agentActive?: boolean;
  currentTask?: AgentTask;
}) {
  const net = (network ?? "mainnet").toUpperCase();
  // Chain-aware: in Hood mode the card speaks ETH. Pre-launch (no Hood mint)
  // there ARE no Hood flows yet, so the stats/badge/sparkline show an honest
  // pre-launch state — never Solana flows dressed up in ETH units.
  const { chain } = useChain();
  const hoodMode = chain === "hood" && !process.env.NEXT_PUBLIC_HOOD_LOOP_MINT;
  // The treasury also holds the project's OWN token. Shown as a separate line —
  // its market value is illiquid/circular, so it sits ALONGSIDE the spendable
  // SOL, never folded into it (honest by design).
  const tokenSymbol = (ticker ?? "$LOOP").replace(/^\$/, "");
  const hasToken = typeof treasuryToken === "number" && treasuryToken > 0;
  // Headline the spendable treasury in USD (SOL × live price); the SOL amount
  // moves to a sub-line. The curve is the real on-chain balance trajectory,
  // valued at the current SOL price — every level is a real on-chain balance.
  const spendableUsd = engine.balance * solUsd;
  // Headline the REAL total the treasury controls: spendable SOL + the live value
  // of the project tokens it holds. The SOL/token breakdown stays on the sub-lines.
  const heldUsd = typeof treasuryTokenUsd === "number" && treasuryTokenUsd > 0 ? treasuryTokenUsd : 0;
  const holdings = treasuryHoldings ?? [];
  const holdingsUsd = holdings.reduce((sum, h) => sum + (h.valueUsd ?? 0), 0);
  const totalUsd = spendableUsd + heldUsd + holdingsUsd;
  const series =
    treasuryHistory && treasuryHistory.length >= 2
      ? treasuryHistory.map((p) => p.sol * solUsd)
      : null;
  // 24h income/spend from the REAL on-chain trajectory: sum the SOL deltas whose
  // tx landed in the last 24h (creator-fee claims in, buybacks out). Honest —
  // every number is a real balance change, not the simulated engine's zeros.
  // (BalancePoint.t is unix SECONDS, see lib/solana.ts.)
  const dayAgoSec = Date.now() / 1000 - 24 * 60 * 60;
  let income24 = 0;
  let spend24 = 0;
  if (treasuryHistory && treasuryHistory.length >= 2) {
    for (let i = 1; i < treasuryHistory.length; i++) {
      if (treasuryHistory[i].t < dayAgoSec) continue;
      const delta = treasuryHistory[i].sol - treasuryHistory[i - 1].sol;
      if (delta > 0) income24 += delta;
      else spend24 += -delta;
    }
  }
  return (
    <div className="bg-surface border border-line-2 rounded-[18px] p-[26px] shadow-[0_1px_2px_rgba(22,19,26,0.04),0_12px_32px_-16px_rgba(22,19,26,0.10)]">
      <div className="flex items-center justify-between mb-[14px]">
        <span className="font-display font-semibold text-[15px]">LOOP Treasury</span>
        {hoodMode ? (
          <span className="inline-flex items-center gap-[6px] font-mono text-[11.5px] text-faint">
            <span className="w-[6px] h-[6px] rounded-full bg-faint" />
            HOOD · COMING SOON
          </span>
        ) : launched ? (
          <span className="inline-flex items-center gap-[6px] font-mono text-[11.5px] text-accent-text">
            <span className="w-[6px] h-[6px] rounded-full bg-accent animate-pulseFast" />
            LIVE · {net}
          </span>
        ) : (
          <span className="inline-flex items-center gap-[6px] font-mono text-[11.5px] text-faint">
            <span className="w-[6px] h-[6px] rounded-full bg-faint" />
            PRE-LAUNCH
          </span>
        )}
      </div>
      <div className="font-display font-bold text-[42px] tracking-[-0.02em] leading-none tabular-nums">
        <span className="text-[22px] text-faint font-medium align-top mr-[1px]">$</span>
        {usd(totalUsd)}
      </div>
      <div className="mt-[6px] mb-4">
        {/* One treasury, two markets: both taps always listed so the Hood view
            never reads as "the treasury is in SOL" — the ETH line shows its
            pre-launch state until $LOOP is live on Hood. */}
        <div className="font-mono text-[13px] text-faint">
          {sol(engine.balance)} SOL spendable <span className="text-faint/60">· Solana</span>
        </div>
        <div className="font-mono text-[12px] text-faint mt-[5px]">
          {process.env.NEXT_PUBLIC_HOOD_LOOP_MINT ? "" : "— "}ETH{" "}
          <span className="text-faint/60">
            · Hood{process.env.NEXT_PUBLIC_HOOD_LOOP_MINT ? "" : " (coming soon)"}
          </span>
        </div>
        {hasToken ? (
          <div className="font-mono text-[12px] text-faint mt-[5px]">
            + {compactNum(treasuryToken!)} {tokenSymbol}
            {typeof treasuryTokenUsd === "number" && treasuryTokenUsd > 0 ? (
              <span className="text-faint/70"> ≈ ${usd(treasuryTokenUsd)} held</span>
            ) : null}
          </div>
        ) : null}
        {holdings.length > 0 ? (
          <div className="font-mono text-[12px] text-faint mt-[5px] flex flex-wrap gap-x-[10px] gap-y-[3px]">
            <span className="text-faint/70">holdings:</span>
            {holdings.map((h) => (
              <span key={h.symbol}>
                {compactNum(h.amount)} {h.symbol}
                {h.valueUsd != null ? <span className="text-faint/70"> (${usd(h.valueUsd)})</span> : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <TreasurySparkline values={hoodMode ? null : series} />
      {hoodMode ? (
        // Hood tap pre-launch: no ETH flows exist yet — honest zeros in ETH,
        // never the Solana trajectory relabelled.
        <div className="grid grid-cols-4 gap-[10px] border-t border-line-4 pt-4">
          <Stat label="24h Income" value="— ETH" />
          <Stat label="24h Spend" value="— ETH" />
          <Stat label="Runtime" value="○ Soon" />
          <Stat label="Opens with" value="$LOOP" />
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-[10px] border-t border-line-4 pt-4">
          <Stat label="24h Income" value={`+${sol(income24)} SOL`} tone="pos" />
          <Stat label="24h Spend" value={`−${sol(spend24)} SOL`} />
          <Stat
            label="Runtime"
            value={agentActive ? "● Active" : "○ Idle"}
            tone={agentActive ? "pos" : undefined}
          />
          <Stat label="Next Check" value={agentActive ? "~2 min" : "—"} />
        </div>
      )}
      {currentTask && (
        <div className="flex items-center gap-[8px] mt-3 px-[10px] py-[8px] rounded-[8px] bg-accent/[0.06] border border-accent/20">
          <span className="w-[6px] h-[6px] shrink-0 rounded-full bg-accent animate-pulseFast" />
          <span className="font-mono text-[11.5px] text-accent-text truncate">
            building · {currentTask.title}
          </span>
        </div>
      )}
      <p className="font-mono text-[11px] text-faint mt-3 mb-0 leading-[1.5]">
        Trading fees → treasury → the agent ships. Every trade funds the build.
      </p>
    </div>
  );
}

/**
 * Treasury value sparkline from the REAL on-chain balance trajectory. Points are
 * event-spaced (one per balance-changing tx), so the shape is honest. With fewer
 * than two points there's nothing to draw → a neutral dashed baseline, never a
 * fabricated curve.
 */
function TreasurySparkline({ values }: { values: number[] | null }) {
  const W = 200;
  const H = 48;
  const PAD = 4;

  if (!values || values.length < 2) {
    return (
      <svg
        width="100%"
        height={56}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block mb-[18px]"
      >
        <line
          x1="0"
          y1="40"
          x2={W}
          y2="40"
          stroke="var(--line-3)"
          strokeWidth={2}
          strokeDasharray="3 4"
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const n = values.length;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2);
  const line = values
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(2)}`)
    .join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;

  return (
    <svg
      width="100%"
      height={56}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block mb-[18px]"
      role="img"
      aria-label="Treasury value over time"
    >
      <defs>
        <linearGradient id="treasury-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#treasury-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos";
}) {
  return (
    <div>
      <div className="text-[11px] text-faint mb-1">{label}</div>
      <div
        className={`font-mono text-[13.5px] ${
          tone === "pos" ? "text-pos" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
