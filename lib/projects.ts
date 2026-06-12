import type { Project, ProjectKey } from "./types";

// The canonical project registry. In production this would come from
// Supabase (`select * from projects`). Cover gradients stand in for the
// generated cover art shown in the design boards.
export const PROJECTS: Record<ProjectKey, Project> = {
  loop: {
    key: "loop",
    name: "LOOP",
    ticker: "$LOOP",
    description: "The project that builds Loop. The platform funds itself.",
    official: true,
    launchpad: "Pump.fun",
    repo: "github.com/loop-fun/loop",
    cover: "loop",
    price: 0.0421,
    marketCap: "$4.21M",
    liquidity: "$312K",
    holders: "8,412",
    volume24h: "45.2K SOL",
    curve: 1,
    supply: "100M",
    treasurySol: 12.46,
    earnedSol: 28.54,
    burnPerDay: "0.42 SOL/day",
    runway: "29 days",
  },
  gtavi: {
    key: "gtavi",
    name: "GTA-before-GTA6",
    ticker: "$GTAVI",
    description: "Recreating GTA 6 before its official release.",
    official: false,
    launchpad: "Pump.fun",
    repo: "github.com/loop-fun/gtavi",
    cover: "sunset",
    price: 0.00084,
    marketCap: "$840K",
    liquidity: "$96K",
    holders: "3,107",
    volume24h: "23.7K SOL",
    curve: 0.62,
    supply: "1B",
    treasurySol: 8.21,
    earnedSol: 14.02,
    burnPerDay: "0.31 SOL/day",
    runway: "26 days",
  },
  owrpg: {
    key: "owrpg",
    name: "Open World RPG",
    ticker: "$OWRPG",
    description: "An open world RPG fully built by AI.",
    official: false,
    launchpad: "Bags.fun",
    repo: "github.com/loop-fun/owrpg",
    cover: "forest",
    price: 0.00037,
    marketCap: "$370K",
    liquidity: "$48K",
    holders: "1,584",
    volume24h: "12.1K SOL",
    curve: 0.41,
    supply: "1B",
    treasurySol: 3.47,
    earnedSol: 6.88,
    burnPerDay: "0.18 SOL/day",
    runway: "19 days",
  },
  aivid: {
    key: "aivid",
    name: "AI Video Generator",
    ticker: "$AIVID",
    description: "Generate videos from text using autonomous AI.",
    official: false,
    launchpad: "Bags.fun",
    repo: "github.com/loop-fun/aivid",
    cover: "neon",
    price: 0.00029,
    marketCap: "$290K",
    liquidity: "$39K",
    holders: "1,102",
    volume24h: "8.2K SOL",
    curve: 0.33,
    supply: "1B",
    treasurySol: 2.91,
    earnedSol: 4.95,
    burnPerDay: "0.14 SOL/day",
    runway: "21 days",
  },
};

export const PROJECT_LIST: Project[] = Object.values(PROJECTS);

export function isProjectKey(v: string | null | undefined): v is ProjectKey {
  return !!v && v in PROJECTS;
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
