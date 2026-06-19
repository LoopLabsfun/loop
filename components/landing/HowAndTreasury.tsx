import type { LoopEngineState } from "@/lib/useLoopEngine";
import { sol } from "@/lib/format";

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

export function HowAndTreasury({
  engine,
  agentActive = false,
  earned = 0,
  launched = false,
  commits = [],
}: {
  engine: LoopEngineState;
  /** Real signal: the LOOP agent ticked recently (from agent_tasks/agent_posts). */
  agentActive?: boolean;
  /** Real cumulative SOL earned (creator fees), from the project row. */
  earned?: number;
  /** True once $LOOP is minted on-chain — so we never read "pre-launch" when it's live. */
  launched?: boolean;
  /** Real recent commits from the repo (newest first). */
  commits?: { hash: string; msg: string }[];
}) {
  // Honest status: the treasury is "on-chain" the moment the token is launched;
  // the agent is "active" only when it actually ticked recently. No fake
  // countdown, no "idle/not started" while it's live.
  const live = agentActive;
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
            {launched ? "Live Treasury" : "Treasury"}
          </h2>
          <span className="font-mono text-[12px] text-faint">
            {launched ? "on-chain" : "pre-launch"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-[10px]">
          <TreasuryStat label="Balance" value={`${sol(engine.balance)} SOL`} />
          <TreasuryStat label="Total Earned" value={`${sol(earned)} SOL`} />
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
            {commits.length === 0 ? (
              <div className="text-[12px] text-faint">No commits yet.</div>
            ) : (
              <div className="flex flex-col gap-[7px]">
                {commits.slice(0, 4).map((c) => (
                  <div key={c.hash} className="font-mono text-[11.5px] truncate">
                    <span className="text-accent-text">{c.hash}</span>{" "}
                    <span className="text-muted">{c.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-line-4 pt-[14px] flex justify-between items-center">
          <span className="text-[13px] text-muted">Agent status</span>
          {live ? (
            <span className="font-mono text-[13px] text-pos">
              ● active — building $LOOP
            </span>
          ) : launched ? (
            <span className="font-mono text-[13px] text-faint">
              ○ idle between ticks
            </span>
          ) : (
            <span className="font-mono text-[13px] text-faint">○ pre-launch</span>
          )}
        </div>
      </div>

      {/* Loop engine terminal */}
      <AgentTerminal live={live} commits={commits} />
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

function AgentTerminal({
  live,
  commits,
}: {
  live: boolean;
  commits: { hash: string; msg: string }[];
}) {
  return (
    <div className="lg:col-span-2 bg-ink rounded-[18px] px-[26px] py-[22px] font-mono">
      <div className="flex items-center justify-between mb-[14px]">
        <div className="flex items-center gap-[10px]">
          <span
            className={`w-2 h-2 rounded-full ${live ? "bg-accent-400 animate-pulseFast" : "bg-muted"}`}
          />
          <span className="text-[12.5px] text-canvas">
            loop-engine · agent $LOOP · {live ? "live" : "idle"}
          </span>
        </div>
        <a
          href="/token?p=loop"
          className="text-[11.5px] text-muted hover:text-canvas transition-colors"
        >
          {live ? "watch live →" : "view project →"}
        </a>
      </div>
      <div className="flex flex-col gap-[7px]">
        {commits.length === 0 ? (
          <div className="text-[12.5px] text-muted">
            No build activity yet — the latest commits appear here as the agent
            ships.
          </div>
        ) : (
          <>
            {commits.slice(0, 5).map((c) => (
              <div key={c.hash} className="text-[12.5px] text-[#B7B2BE] animate-fadeInFast">
                <span className="text-accent-400">{c.hash}</span> {c.msg}
              </div>
            ))}
            {live && (
              <div className="text-[12.5px] text-muted">
                <span className="animate-pulseTick">▮</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
