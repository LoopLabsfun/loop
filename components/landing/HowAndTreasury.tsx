import type { LoopEngineState } from "@/lib/useLoopEngine";
import { countdown, sol } from "@/lib/format";

// Natural 1→6 order so the DOM (and the single-column mobile layout) reads in
// sequence. On ≥sm the grid flows column-first (see below) so it still renders
// as 1-2-3 (left) / 4-5-6 (right) on desktop.
const STEPS = [
  { n: 1, title: "Launch a Project", body: "Submit a name, a vision, and an initial prompt." },
  { n: 2, title: "Token is Created", body: "Loop launches your token on Pump.fun." },
  { n: 3, title: "Rewards Connect", body: "Creator rewards stream into the project wallet." },
  { n: 4, title: "AI Starts Building", body: "An agent codes, deploys, and runs outreach — on the treasury's budget." },
  { n: 5, title: "Traders Fund It", body: "Trading activity generates fees and fills the treasury." },
  { n: 6, title: "Project Evolves", body: "The more it grows, the more it gets funded." },
];

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
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:grid-flow-col sm:grid-rows-3 gap-x-6 gap-y-[18px]">
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

      {/* Treasury */}
      <div className="bg-surface border border-line-2 rounded-[18px] p-7 flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display font-bold text-[24px] tracking-[-0.02em] m-0">
            {engine.live ? "Live Treasury" : "Treasury"}
          </h2>
          <span className="font-mono text-[12px] text-faint">
            {engine.live ? "on-chain" : "devnet · no wallet yet"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-[10px]">
          <TreasuryStat label="Balance" value={`${sol(engine.balance)} SOL`} />
          <TreasuryStat label="Total Earned" value={`${sol(engine.income)} SOL`} />
          <TreasuryStat label="Burn Rate" value="0.00 / day" />
        </div>
        <div className="grid grid-cols-2 gap-4 flex-1">
          <div>
            <div className="text-[12px] text-faint mb-[10px]">
              Recent Claims · Pump.fun
            </div>
            {engine.claims.length === 0 ? (
              <div className="text-[12px] text-faint">No claims yet.</div>
            ) : (
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
            )}
          </div>
          <div>
            <div className="text-[12px] text-faint mb-[10px]">
              Recent Commits · GitHub
            </div>
            <div className="text-[12px] text-faint">
              Appear once the agent runs.
            </div>
          </div>
        </div>
        <div className="border-t border-line-4 pt-[14px] flex justify-between items-center">
          <span className="text-[13px] text-muted">Agent status</span>
          {engine.live ? (
            <span className="font-mono text-[13px] text-pos">
              ● coding — next check {countdown(engine.countdown)}
            </span>
          ) : (
            <span className="font-mono text-[13px] text-faint">
              ○ idle — starts when the treasury is funded
            </span>
          )}
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
          <span
            className={`w-2 h-2 rounded-full ${engine.live ? "bg-accent-400 animate-pulseFast" : "bg-muted"}`}
          />
          <span className="text-[12.5px] text-canvas">
            loop-engine · agent $LOOP · {engine.live ? "live" : "idle"}
          </span>
        </div>
        <span className="text-[11.5px] text-muted">
          {engine.live ? "streaming" : "not started"}
        </span>
      </div>
      <div className="flex flex-col gap-[7px]">
        {engine.agentLog.length === 0 ? (
          <div className="text-[12.5px] text-muted">
            Agent starts logging once it runs — the build stream appears here in
            real time.
          </div>
        ) : (
          <>
            {engine.agentLog.map((l, i) => (
              <div key={i} className="text-[12.5px] text-[#B7B2BE] animate-fadeInFast">
                <span className="text-accent-400">{l.t}</span> {l.msg}
              </div>
            ))}
            <div className="text-[12.5px] text-muted">
              <span className="animate-pulseTick">▮</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
