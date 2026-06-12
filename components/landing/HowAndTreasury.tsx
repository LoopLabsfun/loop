import type { LoopEngineState } from "@/lib/useLoopEngine";
import { getRecentCommits } from "@/lib/api";
import { countdown, sol } from "@/lib/format";

const STEPS = [
  { n: 1, title: "Launch a Project", body: "Submit a name, a vision, and an initial prompt." },
  { n: 4, title: "AI Starts Building", body: "An agent codes in the cloud, on your budget." },
  { n: 2, title: "Token is Created", body: "Loop launches your token on Pump.fun or Bags.fun." },
  { n: 5, title: "Traders Fund It", body: "Trading activity generates fees and fills the treasury." },
  { n: 3, title: "Rewards Connect", body: "Creator rewards stream into the project wallet." },
  { n: 6, title: "Project Evolves", body: "The more it grows, the more it gets funded." },
];

const COMMITS = getRecentCommits();

export function HowAndTreasury({ engine }: { engine: LoopEngineState }) {
  return (
    <section
      id="loop-how"
      className="max-w-[1160px] mx-auto px-10 pt-10 pb-7 grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-4 items-stretch"
    >
      {/* How Loop Works */}
      <div className="bg-surface border border-line-2 rounded-[18px] p-7">
        <h2 className="font-display font-bold text-[24px] tracking-[-0.02em] m-0 mb-[22px]">
          How Loop Works
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-[18px]">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-3">
              <span className="flex-none w-7 h-7 rounded-full bg-accent-tint text-accent-text font-display font-semibold text-[13px] flex items-center justify-center">
                {s.n}
              </span>
              <div>
                <div className="font-display font-semibold text-[14.5px] mb-[3px]">
                  {s.title}
                </div>
                <div className="text-[13px] text-muted leading-[1.45]">
                  {s.body}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 px-5 py-4 rounded-[12px] bg-accent-tint border border-accent-tint-border text-center">
          <div className="font-display font-semibold text-[15px] text-accent-d mb-[3px]">
            The Loop is infinite.
          </div>
          <div className="text-[13px] text-muted">
            Markets fund the code. Code creates value. Value attracts markets.
          </div>
        </div>
      </div>

      {/* Live Treasury */}
      <div className="bg-surface border border-line-2 rounded-[18px] p-7 flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display font-bold text-[24px] tracking-[-0.02em] m-0">
            Live Treasury
          </h2>
          <span className="font-mono text-[12px] text-faint">7xK…g4fR</span>
        </div>
        <div className="grid grid-cols-3 gap-[10px]">
          <TreasuryStat label="Balance" value={`${sol(engine.balance)} SOL`} />
          <TreasuryStat label="Total Earned" value="28.54 SOL" />
          <TreasuryStat label="Burn Rate" value="0.42 / day" />
        </div>
        <div className="grid grid-cols-2 gap-4 flex-1">
          <div>
            <div className="text-[12px] text-faint mb-[10px]">
              Recent Claims · Pump.fun
            </div>
            <div className="flex flex-col gap-[9px]">
              {engine.claims.map((c, i) => (
                <div
                  key={`${c.when}-${i}`}
                  className="flex justify-between font-mono text-[12px] animate-fadeIn"
                >
                  <span className="text-muted">{c.when}</span>
                  <span className="text-pos">+{c.amount} SOL</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[12px] text-faint mb-[10px]">
              Recent Commits · GitHub
            </div>
            <div className="flex flex-col gap-[9px]">
              {COMMITS.map((c) => (
                <div key={c.message} className="font-mono text-[12px] text-muted truncate">
                  {c.message}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-line-4 pt-[14px] flex justify-between items-center">
          <span className="text-[13px] text-muted">Agent status</span>
          <span className="font-mono text-[13px] text-pos">
            ● coding — next check {countdown(engine.countdown)}
          </span>
        </div>
      </div>

      {/* Loop engine terminal */}
      <AgentTerminal engine={engine} />
    </section>
  );
}

function TreasuryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2 rounded-[10px] p-3">
      <div className="text-[11px] text-faint mb-1">{label}</div>
      <div className="font-mono text-[15px] font-medium">{value}</div>
    </div>
  );
}

function AgentTerminal({ engine }: { engine: LoopEngineState }) {
  return (
    <div className="lg:col-span-2 bg-ink rounded-[18px] px-[26px] py-[22px] font-mono">
      <div className="flex items-center justify-between mb-[14px]">
        <div className="flex items-center gap-[10px]">
          <span className="w-2 h-2 rounded-full bg-accent-400 animate-pulseFast" />
          <span className="text-[12.5px] text-canvas">
            loop-engine · agent $LOOP · live
          </span>
        </div>
        <span className="text-[11.5px] text-muted">cycle #1,284 · uptime 41d</span>
      </div>
      <div className="flex flex-col gap-[7px]">
        {engine.agentLog.map((l, i) => (
          <div key={i} className="text-[12.5px] text-[#B7B2BE] animate-fadeInFast">
            <span className="text-accent-400">{l.t}</span> {l.msg}
          </div>
        ))}
        <div className="text-[12.5px] text-muted">
          <span className="animate-pulseTick">▮</span>
        </div>
      </div>
    </div>
  );
}
