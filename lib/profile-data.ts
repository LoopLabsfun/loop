import "server-only";
import { supabaseAdmin } from "./supabase";
import { getProjects } from "./queries";
import { getSplBalance } from "./solana";
import { getMarketStats } from "./market";
import type { Network } from "./solana";
import type { Profile, Project } from "./types";

// Server-only seam for the user PROFILE page. Composes everything a profile shows
// from sources that already exist — the profiles table (identity), getProjects
// (launched + positions), Helius (on-chain token balances), and the agent_* tables
// (the creator's project log/decisions). Keyed by wallet pubkey, the Loop identity.

/** A nonzero holding of a Loop project's token by this wallet. */
export interface Position {
  key: string;
  name: string;
  ticker: string;
  mint: string;
  network: Network;
  /** uiAmount of the token held (decimals applied). */
  amount: number;
  /** Live USD value of the holding (amount × priceUsd), or null when no price. */
  valueUsd: number | null;
}

/** Founder-only aggregate: the self-funding loop, summed across the wallet's
 *  launched projects — the same thesis the token page proves, on the profile. */
export interface BuilderImpact {
  /** Features shipped by this wallet's agents (shipped agent_tasks). */
  shipped: number;
  /** Combined live treasury across launched projects, in SOL. */
  treasurySol: number;
  /** Launched projects with a live on-chain token. */
  liveTokens: number;
}

/** One entry in a creator's project log: a ship, a steering decision, or an
 *  open escalation awaiting them. */
export interface CreatorLogItem {
  kind: "ship" | "decision" | "escalation";
  projectKey: string;
  ticker: string;
  text: string;
  status: string;
  at: string;
}

export interface ProfileView {
  profile: Profile;
  /** Projects this wallet launched (creator_wallet === wallet). */
  launched: Project[];
  /** Nonzero Loop-token holdings, biggest first. */
  positions: Position[];
  /** Combined USD value of all positions priced this request, or null if none priced. */
  portfolioUsd: number | null;
  /** The self-funding loop summed across launched projects; null for non-founders. */
  builder: BuilderImpact | null;
  /** Recent log of the creator's projects (newest first); [] if they launched none. */
  log: CreatorLogItem[];
}

const EMPTY = (wallet: string): Profile => ({
  wallet,
  displayName: null,
  bio: null,
  avatarUrl: null,
  twitterHandle: null,
  twitterVerified: false,
  createdAt: null,
});

interface ProfileRow {
  wallet: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  twitter_handle: string | null;
  twitter_verified: boolean | null;
  created_at: string | null;
}

function rowToProfile(r: ProfileRow): Profile {
  return {
    wallet: r.wallet,
    displayName: r.display_name,
    bio: r.bio,
    avatarUrl: r.avatar_url,
    twitterHandle: r.twitter_handle,
    twitterVerified: Boolean(r.twitter_verified),
    createdAt: r.created_at,
  };
}

/** The stored profile for `wallet`, or an empty default (the wallet alone is a
 *  valid profile — enrichment is optional). Never throws. */
export async function getProfile(wallet: string): Promise<Profile> {
  const sb = supabaseAdmin;
  if (!sb) return EMPTY(wallet);
  const { data } = await sb
    .from("profiles")
    .select("wallet,display_name,bio,avatar_url,twitter_handle,twitter_verified,created_at")
    .eq("wallet", wallet)
    .maybeSingle();
  return data ? rowToProfile(data as ProfileRow) : EMPTY(wallet);
}

async function getPositions(wallet: string, projects: Project[]): Promise<Position[]> {
  const withMint = projects.filter((p) => p.mint);
  const held: (Position | null)[] = await Promise.all(
    withMint.map(async (p): Promise<Position | null> => {
      const net: Network = p.network === "devnet" ? "devnet" : "mainnet";
      const amount = await getSplBalance(wallet, p.mint as string, net);
      if (!amount || amount <= 0) return null;
      // Price the holding (mainnet only — devnet has no real market). A missing
      // price leaves valueUsd null so the UI shows the amount without a $ figure.
      const stats = net === "mainnet" ? await getMarketStats(p.mint as string) : null;
      const valueUsd = stats && stats.priceUsd > 0 ? amount * stats.priceUsd : null;
      return { key: p.key, name: p.name, ticker: p.ticker, mint: p.mint as string, network: net, amount, valueUsd };
    })
  );
  // Sort by USD value when known (real worth), falling back to raw amount.
  return held
    .filter((x): x is Position => x !== null)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0) || b.amount - a.amount);
}

/** The self-funding loop, summed across a founder's launched projects. */
async function getBuilderImpact(launched: Project[]): Promise<BuilderImpact | null> {
  if (launched.length === 0) return null;
  const sb = supabaseAdmin;
  let shipped = 0;
  if (sb) {
    const { count } = await sb
      .from("agent_tasks")
      .select("*", { count: "exact", head: true })
      .in("project_key", launched.map((p) => p.key))
      .eq("status", "shipped");
    shipped = count ?? 0;
  }
  return {
    shipped,
    treasurySol: launched.reduce((sum, p) => sum + (p.treasurySol || 0), 0),
    liveTokens: launched.filter((p) => p.mint).length,
  };
}

async function getCreatorLog(launchedKeys: string[]): Promise<CreatorLogItem[]> {
  const sb = supabaseAdmin;
  if (!sb || launchedKeys.length === 0) return [];
  const tickerOf = (k: string) => `$${k.toUpperCase()}`;
  const [tasksR, escR] = await Promise.all([
    sb
      .from("agent_tasks")
      .select("project_key,title,status,updated_at")
      .in("project_key", launchedKeys)
      .in("status", ["shipped", "building"])
      .order("updated_at", { ascending: false })
      .limit(12),
    sb
      .from("agent_escalations")
      .select("project_key,body,status,created_at")
      .in("project_key", launchedKeys)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);
  const rel = (iso: string | null) => {
    if (!iso) return "";
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.round(mins / 60)}h`;
    return `${Math.round(mins / 1440)}d`;
  };
  const ships: CreatorLogItem[] = ((tasksR.data ?? []) as { project_key: string; title: string; status: string; updated_at: string }[]).map(
    (t) => ({
      kind: t.status === "shipped" ? "ship" : "decision",
      projectKey: t.project_key,
      ticker: tickerOf(t.project_key),
      text: t.title,
      status: t.status,
      at: rel(t.updated_at),
    })
  );
  const escs: CreatorLogItem[] = ((escR.data ?? []) as { project_key: string; body: string; status: string; created_at: string }[]).map(
    (e) => ({
      kind: "escalation",
      projectKey: e.project_key,
      ticker: tickerOf(e.project_key),
      text: e.body,
      status: "awaiting you",
      at: rel(e.created_at),
    })
  );
  // Dedupe the ship/decision stream by title — the agent can re-enqueue the same
  // task title across cycles, and a profile log of repeated lines reads as noise.
  // Ordered newest-first already, so keep the first occurrence of each title.
  const seen = new Set<string>();
  const dedupedShips = ships.filter((s) => {
    const k = s.text.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Escalations first (they need the founder), then the ship/decision stream.
  return [...escs, ...dedupedShips].slice(0, 16);
}

/** Everything the profile page renders for `wallet`, composed from existing
 *  sources. getProjects() already overrides snapshots with live balances. */
export async function getProfileView(wallet: string): Promise<ProfileView> {
  const projects = await getProjects();
  const launched = projects.filter((p) => p.creatorWallet === wallet);
  const [profile, positions, log, builder] = await Promise.all([
    getProfile(wallet),
    getPositions(wallet, projects),
    getCreatorLog(launched.map((p) => p.key)),
    getBuilderImpact(launched),
  ]);
  const priced = positions.filter((p) => p.valueUsd != null);
  const portfolioUsd = priced.length > 0 ? priced.reduce((s, p) => s + (p.valueUsd as number), 0) : null;
  return { profile, launched, positions, portfolioUsd, builder, log };
}
