import { useRouter } from "next/navigation";
import { LoopMark } from "../LoopMark";
import { COVERS } from "@/lib/projects";
import type { Project } from "@/lib/types";

export function LiveProjects({
  projects,
  loopBalance,
}: {
  projects: Project[];
  loopBalance: number;
}) {
  const router = useRouter();

  return (
    <section id="loop-projects" className="max-w-[1160px] mx-auto px-10 pt-10 pb-7">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="font-display font-bold text-[28px] tracking-[-0.02em] m-0">
          Live Projects
        </h2>
        <span className="text-[14px] text-faint">
          {projects.length} projects · all funded by markets
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {projects.map((p) => (
          <ProjectCard
            key={p.key}
            project={p}
            treasuryOverride={p.key === "loop" ? `${loopBalance.toFixed(2)} SOL` : undefined}
            onClick={() => router.push(`/token?p=${p.key}`)}
          />
        ))}
      </div>
    </section>
  );
}

function ProjectCard({
  project: p,
  treasuryOverride,
  onClick,
}: {
  project: Project;
  treasuryOverride?: string;
  onClick: () => void;
}) {
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
        <div className="grid grid-cols-3 gap-[6px] text-[11px] text-faint border-t border-line-4 pt-[10px]">
          <div>
            Treasury
            <div className="font-mono text-[12px] text-ink mt-[2px]">
              {treasuryOverride ?? `${p.treasurySol.toFixed(2)} SOL`}
            </div>
          </div>
          <div>
            24h Vol
            <div className="font-mono text-[12px] text-ink mt-[2px]">
              {p.volume24h.replace(" SOL", "")}
            </div>
          </div>
          <div>
            Status
            <div className="font-mono text-[12px] text-pos mt-[2px]">Active</div>
          </div>
        </div>
      </div>
    </button>
  );
}
