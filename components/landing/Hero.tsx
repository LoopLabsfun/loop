import { LoopMarkAnimated } from "../LoopMark";
import type { LoopEngineState } from "@/lib/useLoopEngine";
import { countdown, sol, usd } from "@/lib/format";

export function Hero({
  engine,
  solUsd,
  onLaunch,
  onScroll,
}: {
  engine: LoopEngineState;
  solUsd: number;
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
          <p className="font-display font-semibold text-[17px] m-0 mb-8">
            Launch a <span className="text-accent">token</span>. Fund an{" "}
            <span className="text-accent">AI</span>. It runs the rest.
          </p>
          <div className="flex gap-3 mb-9">
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
          <div className="flex items-center gap-[18px] text-[13px] text-faint">
            <span>Built on</span>
            <SolanaLogo />
            <PumpFunLogo />
          </div>
        </div>

        <TreasuryCard engine={engine} solUsd={solUsd} />
      </div>
    </section>
  );
}

function SolanaLogo() {
  // Three slanted bars + wordmark. Gradient is Solana's purple→green brand ramp.
  return (
    <svg
      viewBox="0 0 118 36"
      className="h-[15px] w-auto"
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
      className="h-[17px] w-auto"
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

function TreasuryCard({ engine, solUsd }: { engine: LoopEngineState; solUsd: number }) {
  return (
    <div className="bg-surface border border-line-2 rounded-[18px] p-[26px] shadow-[0_1px_2px_rgba(22,19,26,0.04),0_12px_32px_-16px_rgba(22,19,26,0.10)]">
      <div className="flex items-center justify-between mb-[14px]">
        <span className="font-display font-semibold text-[15px]">LOOP Treasury</span>
        {engine.live ? (
          <span className="inline-flex items-center gap-[6px] font-mono text-[11.5px] text-accent-text">
            <span className="w-[6px] h-[6px] rounded-full bg-accent animate-pulseFast" />
            LIVE
          </span>
        ) : (
          <span className="inline-flex items-center gap-[6px] font-mono text-[11.5px] text-faint">
            <span className="w-[6px] h-[6px] rounded-full bg-faint" />
            PRE-LAUNCH
          </span>
        )}
      </div>
      <div className="font-display font-bold text-[42px] tracking-[-0.02em] leading-none tabular-nums">
        {sol(engine.balance)}{" "}
        <span className="text-[20px] text-faint font-medium">SOL</span>
      </div>
      <div className="font-mono text-[13px] text-faint mt-[6px] mb-4">
        ≈ {usd(engine.balance * solUsd)} USD
      </div>
      <svg
        width="100%"
        height={56}
        viewBox="0 0 200 48"
        preserveAspectRatio="none"
        className="block mb-[18px]"
      >
        <line
          x1="0"
          y1="40"
          x2="200"
          y2="40"
          stroke="var(--line-3)"
          strokeWidth={2}
          strokeDasharray="3 4"
        />
      </svg>
      <div className="grid grid-cols-4 gap-[10px] border-t border-line-4 pt-4">
        <Stat label="24h Income" value={`+${sol(engine.income)} SOL`} tone="pos" />
        <Stat label="24h Spend" value={`−${sol(engine.spend)} SOL`} />
        <Stat
          label="Runtime"
          value={engine.live ? "● Active" : "○ Idle"}
          tone={engine.live ? "pos" : undefined}
        />
        <Stat
          label="Next Check"
          value={engine.live ? countdown(engine.countdown) : "—"}
        />
      </div>
    </div>
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
