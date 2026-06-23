import { useRouter } from "next/navigation";
import { LoopMark } from "../LoopMark";
import { COVERS } from "@/lib/projects";
import { useNetwork } from "@/lib/network";
import { compactUsd } from "@/lib/format";
import type { Network, Project } from "@/lib/types";

// Projects with no stored network predate the devnet/mainnet split → mainnet.
const projectNetwork = (p: Project): Network => p.network ?? "mainnet";

export function LiveProjects({
  projects,
  solUsd,
  activeByKey = {},
}: {
  projects: Project[];
  /** Live SOL/USD, to value the treasury (SOL + the project's own token) in $. */
  solUsd: number;
  /** Real "agent ticked recently" flag per project key (drives the status). */
  activeByKey?: Record<string, boolean>;
}) {
  const router = useRouter();
  const { network } = useNetwork();

  // Show only the projects living on the active cluster. The first client
  // render uses the same env default the server rendered with, so this stays
  // hydration-safe; it re-filters once the persisted choice is reconciled.
  const visible = projects.filter((p) => projectNetwork(p) === network);

  return (
    <section id="loop-projects" className="max-w-[1160px] mx-auto px-10 pt-10 pb-7">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="font-display font-bold text-[28px] tracking-[-0.02em] m-0">
          Live Projects
        </h2>
        <span className="text-[14px] text-faint">
          {visible.length} {visible.length === 1 ? "project" : "projects"} on{" "}
          {network} · funded by markets
        </span>
      </div>
      {visible.length === 0 ? (
        <div className="border border-dashed border-line-3 rounded-[16px] py-12 px-6 text-center">
          <p className="font-display font-semibold text-[16px] m-0 mb-1">
            No projects on {network} yet
          </p>
          <p className="text-[13.5px] text-muted m-0">
            Switch the network in the nav to see {network === "devnet" ? "mainnet" : "devnet"} projects, or launch one here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {visible.map((p) => (
            <ProjectCard
              key={p.key}
              project={p}
              solUsd={solUsd}
              active={!!activeByKey[p.key]}
              onClick={() => router.push(`/token?p=${p.key}`)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectCard({
  project: p,
  solUsd,
  active,
  onClick,
}: {
  project: Project;
  solUsd: number;
  active: boolean;
  onClick: () => void;
}) {
  const launched = !!p.mint;
  // Treasury in $ = spendable SOL + the project's OWN token the treasury holds
  // (for LOOP that's tens of millions of $LOOP) — both live from getProjects().
  const treasuryUsd =
    p.treasurySol * solUsd + (p.treasuryTokenUi ?? 0) * (p.price || 0);
  return (
    <button
      onClick={onClick}
      className={`text-left bg-surface rounded-[16px] overflow-hidden relative cursor-pointer transition-shadow hover:shadow-[0_12px_28px_-14px_rgba(22,19,26,0.18)] ${
        p.official
          ? "border-[1.5px] border-accent-300"
          : "border border-line-2"
      }`}
    >
      {p.official && (
        <span className="absolute top-3 left-3 z-[1] font-mono text-[10.5px] px-[9px] py-1 rounded-[6px] bg-accent text-white">
          OFFICIAL
        </span>
      )}
      {p.network === "devnet" && (
        <span className="absolute top-3 right-3 z-[1] font-mono text-[10.5px] px-[9px] py-1 rounded-[6px] border border-warn text-warn bg-canvas/80">
          devnet
        </span>
      )}
      <div
        className={`h-[120px] flex items-center justify-center ${COVERS[p.cover]}`}
      >
        {p.official && (
          <LoopMark width={64} height={38} stroke="var(--accent)" />
        )}
      </div>
      <div className="p-4">
        <div className="font-display font-semibold text-[16px]">{p.name}</div>
        <div className="font-mono text-[12px] text-accent-text mt-[2px] mb-2">
          {p.ticker}
        </div>
        <p className="text-[13px] text-muted leading-[1.45] m-0 mb-[14px] min-h-[38px]">
          {p.description}
        </p>
        <div className="grid grid-cols-2 gap-x-[6px] gap-y-[10px] text-[11px] text-faint border-t border-line-4 pt-[10px]">
          <div>
            Treasury
            <div className="font-mono text-[12px] text-ink mt-[2px]">
              {launched ? compactUsd(treasuryUsd) : `${p.treasurySol.toFixed(2)} SOL`}
            </div>
          </div>
          <div>
            Market Cap
            <div className="font-mono text-[12px] text-ink mt-[2px]">
              {launched ? p.marketCap : "—"}
            </div>
          </div>
          <div>
            24h Vol
            <div className="font-mono text-[12px] text-ink mt-[2px]">
              {launched ? p.volume24h.replace(" SOL", "") : "—"}
            </div>
          </div>
          <div>
            Status
            {active ? (
              <div className="font-mono text-[12px] text-pos mt-[2px]">● Active</div>
            ) : launched ? (
              <div className="font-mono text-[12px] text-muted mt-[2px]">Idle</div>
            ) : (
              <div className="font-mono text-[12px] text-faint mt-[2px]">Pre-launch</div>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
