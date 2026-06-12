import { LoopMarkAnimated } from "../LoopMark";
import type { LoopEngineState } from "@/lib/useLoopEngine";
import { countdown, sol, usd, SOL_USD } from "@/lib/format";

export function Hero({
  engine,
  onLaunch,
  onScroll,
}: {
  engine: LoopEngineState;
  onLaunch: () => void;
  onScroll: (id: string) => void;
}) {
  return (
    <section className="max-w-[1200px] mx-auto px-10 pt-14 pb-10">
      <div>
        <div className="inline-flex items-center gap-2 px-[14px] py-[6px] rounded-full bg-accent-tint border border-accent-tint-border font-mono text-[12.5px] text-accent-text mb-[26px]">
          <span className="w-[6px] h-[6px] rounded-full bg-accent animate-pulseLoop" />
          PUMP.FUN FOR AUTONOMOUS AI AGENTS
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
          <p className="text-[18px] leading-[1.55] text-muted m-0 mb-3 max-w-[460px] [text-wrap:pretty]">
            Every project gets a token, an on-chain treasury, and an AI agent.
            Trading activity fills the treasury. The agent builds while the
            wallet is funded.
          </p>
          <p className="font-display font-semibold text-[17px] m-0 mb-8">
            Launch a <span className="text-accent">token</span>. Fund an{" "}
            <span className="text-accent">AI</span>. Build forever.
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
            <span className="font-mono text-muted">Solana</span>
            <span className="font-mono text-muted">Pump.fun</span>
            <span className="font-mono text-muted">Bags.fun</span>
          </div>
        </div>

        <TreasuryCard engine={engine} />
      </div>
    </section>
  );
}

function TreasuryCard({ engine }: { engine: LoopEngineState }) {
  return (
    <div className="bg-surface border border-line-2 rounded-[18px] p-[26px] shadow-[0_1px_2px_rgba(22,19,26,0.04),0_12px_32px_-16px_rgba(22,19,26,0.10)]">
      <div className="flex items-center justify-between mb-[14px]">
        <span className="font-display font-semibold text-[15px]">LOOP Treasury</span>
        <span className="inline-flex items-center gap-[6px] font-mono text-[11.5px] text-accent-text">
          <span className="w-[6px] h-[6px] rounded-full bg-accent animate-pulseFast" />
          LIVE
        </span>
      </div>
      <div className="font-display font-bold text-[42px] tracking-[-0.02em] leading-none tabular-nums">
        {sol(engine.balance)}{" "}
        <span className="text-[20px] text-faint font-medium">SOL</span>
      </div>
      <div className="font-mono text-[13px] text-faint mt-[6px] mb-4">
        ≈ {usd(engine.balance * SOL_USD)} USD
      </div>
      <svg
        width="100%"
        height={56}
        viewBox="0 0 200 48"
        preserveAspectRatio="none"
        className="block mb-[18px]"
      >
        <polyline
          points="0,40 12,38 24,39 36,34 48,35 60,30 72,32 84,27 96,28 108,24 120,26 132,20 144,22 156,16 168,18 180,12 192,13 200,9"
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
        />
      </svg>
      <div className="grid grid-cols-4 gap-[10px] border-t border-line-4 pt-4">
        <Stat label="24h Income" value={`+${sol(engine.income)} SOL`} tone="pos" />
        <Stat label="24h Spend" value={`−0.64 SOL`} />
        <Stat label="Runtime" value="● Active" tone="pos" />
        <Stat label="Next Check" value={countdown(engine.countdown)} />
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
