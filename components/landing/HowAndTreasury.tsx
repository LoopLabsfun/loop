"use client";

import { useLiveTreasury } from "@/lib/useLiveTreasury";
import { useInspector } from "@/lib/inspector";
import { parseSolPerDay } from "@/lib/economics";
import { sol, shortAge, usd } from "@/lib/format";
import { AgentEngine } from "../AgentEngine";
import type { Project } from "@/lib/types";
import type { AgentTask } from "@/lib/agent";

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

const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(
    Math.max(0, n)
  );

export function HowAndTreasury({
  project,
  solUsd,
  agentActive = false,
  launched = false,
  commits = [],
  matchCommits,
  tasks = [],
  agentLive = false,
}: {
  /** The LOOP project — drives the live treasury reads + inspector context. */
  project?: Project;
  solUsd: number;
  /** Real signal: the LOOP agent ticked recently (from agent_tasks/agent_posts). */
  agentActive?: boolean;
  /** True once $LOOP is minted on-chain — so we never read "pre-launch" when it's live. */
  launched?: boolean;
  /** Real recent commits from the repo (newest first). */
  commits?: { hash: string; msg: string }[];
  /** Wider commit window to link shipped LIVE-LOG rows to their commit. */
  matchCommits?: { hash: string; msg: string }[];
  /** The LOOP agent's real tasks for the shared loop-engine LIVE LOG. */
  tasks?: AgentTask[];
  /** Whether the agent has real activity (LIVE LOG indicator), same as the token page. */
  agentLive?: boolean;
}) {
  const { inspect } = useInspector();
  // Live on-chain treasury — the SAME source the token page uses (coherence): the
  // SOL balance, the treasury's $LOOP holdings, total $ value, the live token
  // price, and the real recent SOL inflows (pump.fun claims live here now).
  const t = useLiveTreasury(project?.key ?? "loop", project?.treasurySol ?? 0);
  const sym = (project?.ticker ?? "$LOOP").replace(/^\$/, "");
  const earned = project?.earnedSol ?? 0;

  // The treasury HOLDS the project's own token — that's the reserve the founder
  // sees, not the small SOL line. Balance is denominated in $LOOP per direction.
  const loopHoldings = t.tokenUi ?? project?.treasuryTokenUi ?? 0;
  const balanceUsd = t.valueUsd || t.balance * solUsd;
  // Burn rate expressed in the PROJECT token, not SOL: convert the SOL/day infra
  // cost at the live token price (SOL/day × $/SOL ÷ $/token = token/day).
  const burnSolPerDay = parseSolPerDay(project?.burnPerDay);
  const loopPerDay = t.tokenPriceUsd > 0 ? (burnSolPerDay * solUsd) / t.tokenPriceUsd : 0;

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
          <span className="font-mono text-[12px] inline-flex items-center gap-[6px]">
            {t.live && (
              <span className="w-[6px] h-[6px] rounded-full bg-pos-bright animate-pulseFast" />
            )}
            <span className="text-faint">{launched ? "on-chain" : "pre-launch"}</span>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-[10px]">
          <TreasuryStat
            label="Balance"
            value={`${compact(loopHoldings)} $${sym}`}
            onClick={() =>
              inspect({
                kind: "stat",
                stat: {
                  label: `Treasury Balance`,
                  value: `${compact(loopHoldings)} $${sym}`,
                  help: `The treasury's on-chain reserve of $${sym} (≈ $${usd(balanceUsd)} total with ${sol(t.balance)} SOL spendable for operations). Trading fees and creator claims keep filling it.`,
                },
              })
            }
          />
          <TreasuryStat
            label="Total Earned"
            value={`${sol(earned)} SOL`}
            onClick={() =>
              inspect({
                kind: "stat",
                stat: {
                  label: "Total Earned",
                  value: `${sol(earned)} SOL`,
                  help: "Cumulative creator fees the project has earned since launch, in SOL.",
                },
              })
            }
          />
          <TreasuryStat
            label="Burn Rate"
            value={`${compact(loopPerDay)} $${sym}/d`}
            onClick={() =>
              inspect({
                kind: "stat",
                stat: {
                  label: "Burn Rate",
                  value: `${compact(loopPerDay)} $${sym}/day`,
                  help: `Daily operating cost, expressed in $${sym} (≈ ${sol(burnSolPerDay)} SOL/day of infra). The treasury must out-earn this to keep the agent awake.`,
                },
              })
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-4 flex-1">
          <div>
            <div className="text-[12px] text-faint mb-[10px]">
              Recent Claims · Pump.fun
            </div>
            {t.claims.length === 0 ? (
              <div className="text-[12px] text-faint">
                {launched ? "No claims yet." : "No claims yet."}
              </div>
            ) : (
              <div className="flex flex-col gap-[9px]">
                {t.claims.map((c) => (
                  <button
                    key={c.sig}
                    onClick={() => inspect({ kind: "claim", claim: c })}
                    className="flex justify-between font-mono text-[12px] animate-fadeIn hover:opacity-80 transition-opacity text-left w-full"
                    title="Inspect this inflow"
                  >
                    <span className="text-muted">
                      {shortAge(Math.floor(Date.now() / 1000) - c.at)} ago
                    </span>
                    <span className="text-pos">+{c.sol.toFixed(3)} SOL</span>
                  </button>
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
                  <button
                    key={c.hash}
                    onClick={() => inspect({ kind: "commit", commit: c })}
                    className="font-mono text-[11.5px] truncate text-left w-full hover:opacity-80 transition-opacity"
                    title="Inspect this commit"
                  >
                    <span className="text-accent-text">{c.hash}</span>{" "}
                    <span className="text-muted">{c.msg}</span>
                  </button>
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

      {/* Loop engine terminal — the SAME shared component as the token page. */}
      <AgentEngine
        className="lg:col-span-2"
        repo={project?.repo ?? "LoopLabsfun/loop"}
        label={project?.ticker ?? "$LOOP"}
        commits={commits}
        matchCommits={matchCommits}
        tasks={tasks}
        live={agentLive}
      />
    </section>
  );
}

function TreasuryStat({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`Inspect ${label}`}
      className="bg-surface-2 rounded-[10px] p-3 text-left w-full hover:bg-surface-3 transition-colors"
    >
      <div className="text-[11px] text-faint mb-1">{label}</div>
      <div className="font-mono text-[15px] font-medium">{value}</div>
    </button>
  );
}

