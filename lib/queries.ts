import { supabase } from "./supabase";
import { getSolBalance } from "./solana";
import { PROJECT_LIST, PROJECTS } from "./projects";
import type { Launchpad, Project, ProjectKey } from "./types";

// Shape of a `public.projects` row (snake_case columns).
interface ProjectRow {
  key: string;
  name: string;
  ticker: string;
  description: string;
  official: boolean;
  launchpad: string;
  repo: string;
  cover: string;
  price: number;
  market_cap: string;
  liquidity: string;
  holders: string;
  volume_24h: string;
  curve: number;
  supply: string;
  treasury_sol: number;
  earned_sol: number;
  burn_per_day: string;
  runway: string;
  treasury_wallet: string | null;
  mint: string | null;
  network: string;
  creator_wallet: string | null;
}

function rowToProject(r: ProjectRow): Project {
  return {
    key: r.key as ProjectKey,
    name: r.name,
    ticker: r.ticker,
    description: r.description,
    official: r.official,
    launchpad: r.launchpad as Launchpad,
    repo: r.repo,
    cover: r.cover,
    price: r.price,
    marketCap: r.market_cap,
    liquidity: r.liquidity,
    holders: r.holders,
    volume24h: r.volume_24h,
    curve: r.curve,
    supply: r.supply,
    treasurySol: r.treasury_sol,
    earnedSol: r.earned_sol,
    burnPerDay: r.burn_per_day,
    runway: r.runway,
    treasuryWallet: r.treasury_wallet,
    mint: r.mint,
    network: r.network === "devnet" ? "devnet" : "mainnet",
    creatorWallet: r.creator_wallet,
    treasuryLive: false,
  };
}

/**
 * Replace the stored treasury snapshot with the live on-chain balance for any
 * project that has a `treasuryWallet`. Best-effort: a failed/unconfigured read
 * leaves the snapshot in place. Reads run in parallel.
 */
async function withLiveBalances(projects: Project[]): Promise<Project[]> {
  return Promise.all(
    projects.map(async (p) => {
      if (!p.treasuryWallet) return p;
      const live = await getSolBalance(p.treasuryWallet, p.network);
      if (live === null) return p;
      return { ...p, treasurySol: live, treasuryLive: true };
    })
  );
}

/**
 * All projects, newest first with official surfaced. Falls back to the static
 * registry if Supabase isn't configured or the request fails — the UI never
 * breaks on a cold backend.
 */
export async function getProjects(): Promise<Project[]> {
  if (!supabase) return PROJECT_LIST;
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("official", { ascending: false })
    .order("created_at", { ascending: false });
  if (error || !data?.length) return PROJECT_LIST;
  return withLiveBalances(data.map(rowToProject));
}

/** A single project by key, with the same fallback behaviour. */
export async function getProject(key: string): Promise<Project | null> {
  if (!supabase) return PROJECTS[key as ProjectKey] ?? null;
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return PROJECTS[key as ProjectKey] ?? null;
  const [project] = await withLiveBalances([rowToProject(data)]);
  return project;
}
