import { supabase } from "./supabase";
import { getSolBalanceCached, getSplBalanceCached, getTreasuryHistory } from "./solana";
import { withLiveMarket } from "./token-market";
import { getPrelaunchProjectBySlug } from "./prelaunch-public";
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
  fee_creator_wallet: string | null;
  agent_paused: boolean | null;
  fee_founder_pct: number | null;
  agent_wallet: string | null;
  content_policy: string | null;
  guardrails: string | null;
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  website: string | null;
  token_image_url: string | null;
  banner_url: string | null;
  domain: string | null;
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
    feeCreatorWallet: r.fee_creator_wallet,
    agentPaused: r.agent_paused ?? false,
    feeFounderPct: r.fee_founder_pct ?? undefined,
    agentWallet: r.agent_wallet,
    contentPolicy: r.content_policy,
    guardrails: r.guardrails,
    twitter: r.twitter ?? null,
    telegram: r.telegram ?? null,
    discord: r.discord ?? null,
    website: r.website ?? null,
    tokenImageUrl: r.token_image_url ?? null,
    bannerUrl: r.banner_url ?? null,
    domain: r.domain ?? null,
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
      // Spendable SOL first, so the token holding and the balance trajectory can
      // reuse it (the history then ends on exactly the SOL the card headlines, and
      // we avoid a duplicate balance read). Any read failing leaves that piece off.
      const live = await getSolBalanceCached(p.treasuryWallet, p.network);
      const [tokenUi, history] = await Promise.all([
        p.mint ? getSplBalanceCached(p.treasuryWallet, p.mint, p.network) : Promise.resolve(null),
        getTreasuryHistory(p.treasuryWallet, p.network, {
          knownLamports: live === null ? undefined : Math.round(live * 1e9),
        }),
      ]);
      const next: Project = { ...p };
      if (live !== null) {
        next.treasurySol = live;
        next.treasuryLive = true;
      }
      if (tokenUi !== null) next.treasuryTokenUi = tokenUi;
      if (history && history.length) next.treasuryHistory = history;
      return next;
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
  return withLiveMarket(await withLiveBalances(data.map(rowToProject)));
}

/** A single project by key, with the same fallback behaviour. */
export async function getProject(key: string): Promise<Project | null> {
  if (!supabase) return PROJECTS[key as ProjectKey] ?? (await prelaunchFallback(key));
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return PROJECTS[key as ProjectKey] ?? (await prelaunchFallback(key));
  // Mirror getProjects: overlay live on-chain balances AND live market stats
  // (price/mcap). Without withLiveMarket the single-project path kept the stale
  // stored price (often 0), so the token page valued the treasury's token
  // holdings at $0. Both reads are best-effort + memoized.
  const [project] = await withLiveMarket(await withLiveBalances([rowToProject(data)]));
  return project;
}

/**
 * Last resort for getProject: a key with no `projects` row and no static-registry
 * entry may be a WHITELISTED pre-launch draft. Synthesize it (pre-launch Project)
 * and overlay the live backing balance so the token page renders its pre-launch
 * mode. Returns null when the key isn't a whitelisted draft either.
 */
async function prelaunchFallback(key: string): Promise<Project | null> {
  const pre = await getPrelaunchProjectBySlug(key);
  if (!pre) return null;
  const [withBal] = await withLiveBalances([pre]);
  return withBal;
}
