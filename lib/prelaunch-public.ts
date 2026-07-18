import "server-only";
import { supabaseAdmin } from "./supabase";
import { totalRaised, backerCount, type Contribution } from "./prefunding";
import { slugify } from "./launch";
import type { Chain } from "./chains/types";
import type { Launchpad, Project, ProjectKey } from "./types";

/** The draft's target chain; tolerate a pre-migration table (no column ⇒ solana). */
function draftChain(r: Record<string, unknown>): Chain {
  return r.chain === "hood" ? "hood" : "solana";
}

// PUBLIC pre-launch board data — the curated (whitelisted) projects opening soon,
// with their real pre-funding (the "vote with SOL" social proof). Service-role read
// returning ONLY safe public fields: never the proposer's wallet/email. The
// project_wallet IS returned — it's a public deposit address backers send SOL to.

export interface PublicPrelaunch {
  name: string;
  ticker: string;
  /** Stable URL key (slugify(ticker,name)) — links to /token?p=<slug>. Matches the
   *  eventual launched project key, so the URL survives the mint. */
  slug: string;
  pitch: string | null;
  tokenImageUrl: string | null;
  bannerUrl: string | null;
  /** Public deposit address — back this launch by sending SOL here (refundable).
   *  Always null for hood drafts (SOL backing doesn't apply; ETH backing arrives
   *  with the EVM custody phase — docs/multichain-hood.md). */
  projectWallet: string | null;
  /** SOL currently backing it (confirmed contributions). */
  totalSol: number;
  /** Distinct backers. */
  backers: number;
  /** Target chain the draft launches on. */
  chain: Chain;
}

/** Curated pre-launches for the home board (newest-curated first). Best-effort: a
 *  cold/unconfigured backend returns []. */
export async function getPublicPrelaunches(limit = 12): Promise<PublicPrelaunch[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  // select("*") rather than an explicit column list: the service-role read maps
  // to safe public fields below anyway, and an explicit list would 42703 the
  // whole query on a table that predates a newer column (e.g. `chain`).
  const { data } = await sb
    .from("launch_waitlist")
    .select("*")
    .eq("status", "whitelisted")
    .not("name", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Record<string, unknown>[];
  if (!rows.length) return [];

  // Funding for these drafts in one query, grouped by draft wallet.
  const wallets = rows.map((r) => r.wallet as string);
  const { data: contribs } = await sb
    .from("prelaunch_contributions")
    .select("draft_wallet, contributor_wallet, amount_sol, tx_sig, status")
    .in("draft_wallet", wallets);
  const byDraft = new Map<string, Contribution[]>();
  for (const c of (contribs ?? []) as Record<string, unknown>[]) {
    const k = c.draft_wallet as string;
    const arr = byDraft.get(k) ?? [];
    arr.push({
      contributorWallet: c.contributor_wallet as string,
      amountSol: Number(c.amount_sol),
      txSig: c.tx_sig as string,
      status: (c.status as string) ?? "confirmed",
    });
    byDraft.set(k, arr);
  }

  return rows.map((r) => {
    const ledger = byDraft.get(r.wallet as string) ?? [];
    const name = r.name as string;
    const ticker = (r.ticker as string) ?? "";
    const chain = draftChain(r);
    return {
      name,
      ticker,
      slug: slugify(ticker, name),
      pitch: (r.prompt as string) ?? null,
      tokenImageUrl: (r.token_image_url as string) ?? null,
      bannerUrl: (r.banner_url as string) ?? null,
      // Hood drafts never expose a SOL deposit wallet — backing is gated until
      // EVM custody lands, so the board renders its "backing opens" state.
      projectWallet: chain === "hood" ? null : ((r.project_wallet as string) ?? null),
      totalSol: totalRaised(ledger),
      backers: backerCount(ledger),
      chain,
    };
  });
}

/** A whitelisted draft row addressed by its public slug (slugify(ticker,name)). */
async function findWhitelistedBySlug(
  slug: string,
): Promise<Record<string, unknown> | null> {
  const sb = supabaseAdmin;
  if (!sb) return null;
  // select("*") — same rationale as getPublicPrelaunches (newer columns like
  // `chain` may not exist yet on an unmigrated table).
  const { data } = await sb
    .from("launch_waitlist")
    .select("*")
    .eq("status", "whitelisted")
    .not("name", "is", null);
  const rows = (data ?? []) as Record<string, unknown>[];
  return (
    rows.find((r) => slugify((r.ticker as string) ?? "", r.name as string) === slug) ?? null
  );
}

/**
 * Synthesize a Project from a WHITELISTED pre-launch draft so the token page can
 * render it in its existing pre-launch mode (no `projects` row, no `mint`). The
 * `treasuryWallet` is the pre-funding deposit wallet, so `withLiveBalances` shows
 * the real backing balance. The proposer's wallet is deliberately NOT exposed as
 * `creatorWallet` (it would reveal identity + unlock founder-only UI). Returns null
 * when there's no whitelisted draft for the slug (or it's already launched, which
 * has a real `projects` row that takes precedence upstream).
 */
export async function getPrelaunchProjectBySlug(slug: string): Promise<Project | null> {
  const r = await findWhitelistedBySlug(slug);
  if (!r) return null;
  const name = r.name as string;
  const ticker = (r.ticker as string) ?? "";
  const prompt = (r.prompt as string) ?? name;
  const chain = draftChain(r);
  // Hood drafts hide the SOL deposit wallet — the token page then renders its
  // pre-launch mode WITHOUT the SOL backing card (backing opens with EVM custody).
  const projectWallet = chain === "hood" ? null : ((r.project_wallet as string) ?? null);
  return {
    key: slug as ProjectKey,
    name,
    ticker: `$${ticker}`,
    description: prompt,
    official: false,
    launchpad: "Pump.fun" as Launchpad,
    // Provisioned at whitelist time (lib/prelaunch.provisionDraftHome) — without
    // these, the "Autonomous work" panel's live-site link has nothing to work
    // with (projectSiteUrl needs `repo`/`website`) and silently renders nothing,
    // even though the project's home is already live.
    repo: (r.home_repo as string) ?? "",
    website: (r.home_vercel_url as string) ?? null,
    cover: "neon",
    price: 0,
    marketCap: "—",
    liquidity: "—",
    holders: "—",
    volume24h: "—",
    curve: 0,
    supply: "1B",
    treasurySol: 0,
    earnedSol: 0,
    burnPerDay: "0 SOL/day",
    runway: "pre-launch",
    treasuryWallet: projectWallet,
    mint: null,
    chain,
    network: "mainnet",
    creatorWallet: null,
    feeFounderPct: (r.fee_founder_pct as number) ?? undefined,
    agentWallet: projectWallet,
    treasuryLive: false,
    prelaunch: true,
  };
}

/** Resolve a public slug → the private proposer (draft) wallet, server-side only.
 *  Used by the public backing endpoint to reconcile on-chain contributions without
 *  ever exposing the draft wallet to the client. */
export async function resolveDraftWalletBySlug(slug: string): Promise<string | null> {
  const r = await findWhitelistedBySlug(slug);
  return r ? ((r.wallet as string) ?? null) : null;
}
