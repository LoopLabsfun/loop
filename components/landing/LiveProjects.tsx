import { useRouter } from "next/navigation";
import { LoopMark } from "../LoopMark";
import { COVERS } from "@/lib/projects";
import { useNetwork } from "@/lib/network";
import { useChain } from "@/lib/chains/chain-context";
import { chainInfo } from "@/lib/chains/registry";
import type { Chain } from "@/lib/chains/types";
import { compactUsd } from "@/lib/format";
import type { Network, Project } from "@/lib/types";

// Projects with no stored network predate the devnet/mainnet split → mainnet.
const projectNetwork = (p: Project): Network => p.network ?? "mainnet";
// Projects with no stored chain predate the Solana/Hood split → solana.
const projectChain = (p: Project): Chain => p.chain ?? "solana";

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
  const { chain } = useChain();

  // Show only the projects living on the active chain (and, on Solana, the
  // active cluster — Hood is mainnet-only). The first client render uses the
  // same env default the server rendered with, so this stays hydration-safe;
  // it re-filters once the persisted choice is reconciled.
  const visible = projects.filter(
    (p) =>
      projectChain(p) === chain &&
      (chain === "hood" || projectNetwork(p) === network)
  );
  const placeLabel = chain === "hood" ? chainInfo("hood").label : network;

  return (
    <section id="loop-projects" className="max-w-[1160px] mx-auto px-10 pt-10 pb-7">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="font-display font-bold text-[28px] tracking-[-0.02em] m-0">
          Live Projects
        </h2>
        <span className="text-[14px] text-faint">
          {visible.length} {visible.length === 1 ? "project" : "projects"} on{" "}
          {placeLabel} · funded by markets
        </span>
      </div>
      {visible.length === 0 && chain !== "hood" ? (
        <div className="border border-dashed border-line-3 rounded-[16px] py-12 px-6 text-center">
          <p className="font-display font-semibold text-[16px] m-0 mb-1">
            No projects on {placeLabel} yet
          </p>
          <p className="text-[13.5px] text-muted m-0">
            Switch the network in the nav to see {network === "devnet" ? "mainnet" : "devnet"} projects, or launch one here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* On Hood, LOOP is the flagship — surfaced as an official "coming
              soon" card until it relaunches there (non-launched). */}
          {chain === "hood" && <HoodLoopComingSoon />}
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

// Official LOOP surfaced on the Hood view before its relaunch there — a
// "coming soon" flagship card (non-launched, not clickable) so the Hood tab
// reads as intentional rather than empty. See docs/multichain-hood.md.
function HoodLoopComingSoon() {
  return (
    <div className="text-left bg-surface rounded-[16px] overflow-hidden relative border-[1.5px] border-accent-300">
      <span className="absolute top-3 left-3 z-[1] font-mono text-[10.5px] px-[9px] py-1 rounded-[6px] bg-accent text-white">
        OFFICIAL
      </span>
      <span className="absolute top-3 right-3 z-[1] font-mono text-[10.5px] px-[9px] py-1 rounded-[6px] border border-accent-300 text-accent-text bg-canvas/80">
        Hood
      </span>
      <div className="h-[120px] flex items-center justify-center bg-accent-tint">
        <LoopMark width={64} height={38} stroke="var(--accent)" />
      </div>
      <div className="p-4">
        <div className="font-display font-semibold text-[16px]">Loop</div>
        <div className="font-mono text-[12px] text-accent-text mt-[2px] mb-2">$LOOP</div>
        <p className="text-[13px] text-muted leading-[1.45] m-0 mb-[14px] min-h-[38px] line-clamp-3">
          $LOOP relaunches on Robinhood Chain — one project, one agent, one
          treasury, now funded by two markets. Trading opens when the token goes
          live on Hood.
        </p>
        <div className="grid grid-cols-2 gap-x-[6px] gap-y-[10px] text-[11px] text-faint border-t border-line-4 pt-[10px]">
          <div>
            Treasury
            <div className="font-mono text-[12px] text-ink mt-[2px]">— ETH</div>
          </div>
          <div>
            Market Cap
            <div className="font-mono text-[12px] text-ink mt-[2px]">—</div>
          </div>
          <div>
            24h Vol
            <div className="font-mono text-[12px] text-ink mt-[2px]">—</div>
          </div>
          <div>
            Status
            <div className="font-mono text-[12px] text-accent-text mt-[2px]">◷ Coming soon</div>
          </div>
        </div>
      </div>
    </div>
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
  const chain = projectChain(p);
  // Treasury in $ = spendable SOL + the project's OWN token the treasury holds
  // (for LOOP that's tens of millions of $LOOP) — both live from getProjects().
  // Hood treasuries hold ETH; until an ETH/USD feed lands (Phase 3 in
  // docs/multichain-hood.md) show the native amount instead of a wrong $.
  const treasuryUsd =
    p.treasurySol * solUsd + (p.treasuryTokenUi ?? 0) * (p.price || 0);
  const treasuryNative = `${p.treasurySol.toFixed(2)} ${chainInfo(chain).nativeSymbol}`;
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
      {p.network === "devnet" && projectChain(p) === "solana" && (
        <span className="absolute top-3 right-3 z-[1] font-mono text-[10.5px] px-[9px] py-1 rounded-[6px] border border-warn text-warn bg-canvas/80">
          devnet
        </span>
      )}
      {projectChain(p) === "hood" && (
        <span className="absolute top-3 right-3 z-[1] font-mono text-[10.5px] px-[9px] py-1 rounded-[6px] border border-accent-300 text-accent-text bg-canvas/80">
          Hood
        </span>
      )}
      {p.official ? (
        <div
          className={`h-[120px] flex items-center justify-center ${COVERS[p.cover]}`}
        >
          <LoopMark width={64} height={38} stroke="var(--accent)" />
        </div>
      ) : (
        <div className={`h-[120px] relative ${COVERS[p.cover]}`}>
          {p.bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.bannerUrl}
              alt=""
              className="w-full h-full object-cover"
              // Broken/404 banner → hide so the gradient cover behind shows (never a broken icon).
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          {p.tokenImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={p.tokenImageUrl}
              alt=""
              className="absolute left-4 -bottom-5 w-11 h-11 rounded-full object-cover border-2 border-surface bg-surface"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
        </div>
      )}
      <div className={`p-4 ${!p.official && p.tokenImageUrl ? "pt-7" : ""}`}>
        <div className="font-display font-semibold text-[16px]">{p.name}</div>
        <div className="font-mono text-[12px] text-accent-text mt-[2px] mb-2">
          {p.ticker}
        </div>
        <p className="text-[13px] text-muted leading-[1.45] m-0 mb-[14px] min-h-[38px] line-clamp-3">
          {p.description}
        </p>
        <div className="grid grid-cols-2 gap-x-[6px] gap-y-[10px] text-[11px] text-faint border-t border-line-4 pt-[10px]">
          <div>
            Treasury
            <div className="font-mono text-[12px] text-ink mt-[2px]">
              {launched && chain === "solana" ? compactUsd(treasuryUsd) : treasuryNative}
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
