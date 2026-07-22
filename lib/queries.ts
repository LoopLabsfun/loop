import { supabase, supabaseAdmin } from "./supabase";
import { getSolBalanceCached, getSplBalanceCached, getTreasuryHistory } from "./solana";
import { getEthBalanceCached, getErc20BalanceCached } from "./chains/hood";
import { chainOfAddress } from "./chains/registry";
import type { Chain } from "./chains/types";
import type { ChainDeployment } from "./chains/deployments";
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
  /** Optional until the `chain` column migration is applied — rows without it
   *  fall back to address-shape inference (0x… ⇒ hood), else "solana". */
  chain?: string | null;
  network: string;
  creator_wallet: string | null;
  fee_creator_wallet: string | null;
  fee_sharing_configured_at: string | null;
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

/** Shape of a `public.project_chains` row — a project's deployment on one chain. */
interface ProjectChainRow {
  project_key: string;
  chain: string;
  mint: string | null;
  treasury_wallet: string | null;
  agent_wallet: string | null;
  treasury_native: number;
  earned_native: number;
  launchpad: string | null;
  network: string;
}

/** The row's chain: explicit column first, then address-shape inference for
 *  rows that predate the column (an 0x… treasury/mint can only be Hood). */
function rowChain(r: ProjectRow): Chain {
  if (r.chain === "hood" || r.chain === "solana") return r.chain;
  const addr = r.treasury_wallet ?? r.mint;
  return addr && chainOfAddress(addr) === "hood" ? "hood" : "solana";
}

function rowToDeployment(r: ProjectChainRow): ChainDeployment {
  return {
    chain: r.chain === "hood" ? "hood" : "solana",
    mint: r.mint,
    treasuryWallet: r.treasury_wallet,
    agentWallet: r.agent_wallet,
    treasuryNative: Number(r.treasury_native ?? 0),
    earnedNative: Number(r.earned_native ?? 0),
    launchpad: (r.launchpad as Launchpad | null) ?? null,
    network: r.network === "devnet" ? "devnet" : "mainnet",
  };
}

/**
 * Attach each project's `project_chains` deployments — what makes a project one
 * slug across several chains instead of one row per chain. Best-effort by
 * design: a missing table (schema not yet applied) or a failed read just leaves
 * every project single-chain on its home deployment, exactly as before.
 */
async function withDeployments(projects: Project[]): Promise<Project[]> {
  if (!supabase || !projects.length) return projects;
  try {
    const { data, error } = await supabase
      .from("project_chains")
      .select(
        "project_key, chain, mint, treasury_wallet, agent_wallet, treasury_native, earned_native, launchpad, network"
      )
      .in(
        "project_key",
        projects.map((p) => p.key)
      );
    if (error || !data?.length) return projects;
    const byKey = new Map<string, ChainDeployment[]>();
    for (const row of data as ProjectChainRow[]) {
      const list = byKey.get(row.project_key) ?? [];
      list.push(rowToDeployment(row));
      byKey.set(row.project_key, list);
    }
    return projects.map((p) => {
      const deployments = byKey.get(p.key);
      return deployments?.length ? { ...p, deployments } : p;
    });
  } catch {
    return projects;
  }
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
    chain: rowChain(r),
    network: r.network === "devnet" ? "devnet" : "mainnet",
    creatorWallet: r.creator_wallet,
    feeCreatorWallet: r.fee_creator_wallet,
    feeSharingConfiguredAt: r.fee_sharing_configured_at,
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
      // Hood (EVM) projects: native ETH + the project's own ERC-20, read from
      // the Hood RPC. No balance-history reconstruction yet (needs an indexer
      // pass over Blockscout — Phase 1 tail in docs/multichain-hood.md).
      if (p.chain === "hood") {
        const [live, tokenUi] = await Promise.all([
          getEthBalanceCached(p.treasuryWallet),
          p.mint
            ? getErc20BalanceCached(p.treasuryWallet, p.mint)
            : Promise.resolve(null),
        ]);
        return applyLiveBalance(p, live, tokenUi, null);
      }
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
      return applyLiveBalance(p, live, tokenUi, history);
    })
  );
}

/**
 * Live native balances for the NON-home deployments (the home chain is already
 * covered by withLiveBalances, which also writes the snapshot back). Without
 * this, switching the header to Hood would show $LOOP's stored ETH snapshot
 * while Solana showed a live number — the same treasury card telling two
 * different kinds of truth. Best-effort and parallel: a failed read keeps the
 * snapshot.
 */
async function withLiveDeploymentBalances(projects: Project[]): Promise<Project[]> {
  return Promise.all(
    projects.map(async (p) => {
      const home = p.chain ?? "solana";
      const others = (p.deployments ?? []).filter((d) => d.chain !== home && d.treasuryWallet);
      if (!others.length) return p;
      const refreshed = await Promise.all(
        others.map(async (d) => {
          const live =
            d.chain === "hood"
              ? await getEthBalanceCached(d.treasuryWallet!)
              : await getSolBalanceCached(d.treasuryWallet!, d.network);
          return live === null ? d : { ...d, treasuryNative: live };
        })
      );
      const byChain = new Map(refreshed.map((d) => [d.chain, d]));
      return {
        ...p,
        deployments: (p.deployments ?? []).map((d) => byChain.get(d.chain) ?? d),
      };
    })
  );
}

/** Overlay a live native-balance read (SOL or ETH — `treasurySol` holds native
 *  units per the project's chain) + token holding + history onto a project. */
async function applyLiveBalance(
  p: Project,
  live: number | null,
  tokenUi: number | null,
  history: { t: number; sol: number }[] | null
): Promise<Project> {
  const next: Project = { ...p };
  if (live !== null) {
    next.treasurySol = live;
    next.treasuryLive = true;
    // Keep the stored snapshot in step with the live balance. The budget gate
    // (lib/budget.canAffordTick) runs off treasury_sol, and a later read that
    // fails (RPC blip / Helius rate-limit on the cron's concurrent fan-out)
    // falls back to that stored value. If the snapshot is stale-0, one failed
    // read wrongly SLEEPS a funded project — the bug that left build/ploop/fame
    // dormant. Persist the last-known balance so the fallback is real, not 0.
    // Service-role write (RLS forbids anon updates); best-effort + throttled to
    // material moves so it never churns the hot read path or breaks a render.
    if (supabaseAdmin && Math.abs(live - (p.treasurySol ?? 0)) > 0.0005) {
      try {
        await supabaseAdmin
          .from("projects")
          .update({ treasury_sol: live })
          .eq("key", p.key);
      } catch {
        /* best-effort — a failed snapshot write must never break the read */
      }
    }
  }
  if (tokenUi !== null) next.treasuryTokenUi = tokenUi;
  if (history && history.length) next.treasuryHistory = history;
  return next;
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
  return withLiveMarket(
    await withLiveDeploymentBalances(await withLiveBalances(await withDeployments(data.map(rowToProject))))
  );
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
  const [project] = await withLiveMarket(
    await withLiveDeploymentBalances(await withLiveBalances(await withDeployments([rowToProject(data)])))
  );
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
