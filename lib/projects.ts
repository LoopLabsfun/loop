import type { Project, ProjectKey } from "./types";

// The canonical project registry — the **fallback** used when Supabase is
// unconfigured or a read fails (the UI never breaks on a cold backend). In
// production the live list comes from the `projects` table (lib/queries.ts).
//
// Devnet-first phase: the only project is LOOP itself, on devnet, pre-launch
// (no mint / no treasury / no market yet). Real numbers appear once LOOP is
// minted on devnet and the agent runs against it — nothing here is simulated.
export const PROJECTS: Record<ProjectKey, Project> = {
  loop: {
    key: "loop",
    name: "LOOP",
    ticker: "$LOOP",
    description:
      "The project that builds Loop — the platform funds its own development.",
    official: true,
    launchpad: "Pump.fun",
    repo: "github.com/LoopLabsfun/loop",
    cover: "loop",
    // Pre-launch: no market yet. The UI shows "no market yet" empty states
    // until LOOP is minted and trading begins.
    price: 0,
    marketCap: "—",
    liquidity: "—",
    holders: "0",
    volume24h: "0 SOL",
    curve: 0,
    supply: "—",
    treasurySol: 0,
    earnedSol: 0,
    burnPerDay: "0.00 SOL/day",
    runway: "pre-launch",
    network: "devnet",
    mint: null,
    treasuryWallet: null,
  },
};

export const PROJECT_LIST: Project[] = Object.values(PROJECTS);

export function isProjectKey(v: string | null | undefined): v is ProjectKey {
  return !!v && v in PROJECTS;
}

/**
 * True until the project's token is actually minted on-chain. Pre-launch there
 * is no market, so the UI shows "no market yet" empty states instead of any
 * price / chart / trades.
 */
export function isPreLaunch(p: Pick<Project, "mint">): boolean {
  return !p.mint;
}

/** Cover gradient classes keyed by `Project.cover`. */
export const COVERS: Record<string, string> = {
  loop: "bg-[var(--accent-tint)]",
  sunset:
    "bg-[linear-gradient(135deg,#ff8a5b_0%,#ff5e8a_45%,#7a4bff_100%)]",
  forest:
    "bg-[linear-gradient(135deg,#1f6f54_0%,#2e8b57_40%,#0b3d2e_100%)]",
  neon: "bg-[linear-gradient(135deg,#1b1030_0%,#3b1d6e_50%,#0a84ff_100%)]",
};
