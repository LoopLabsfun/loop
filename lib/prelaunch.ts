import "server-only";
import { supabaseAdmin } from "./supabase";
import { getPrelaunch } from "./waitlist";
import { getSolBalance } from "./solana";
import { createToken, launchpadConfigured, parseCluster } from "./launchpad";
import { agentWalletConfigured, provisionAgentWallet } from "./agent-wallet";
import { parseSecretKeyJson } from "./vanity";
import { slugify, DESCRIPTION_MAX } from "./launch";
import { provisionPlan } from "./provisioning";

// Pre-launch APPROVAL plan + preflight. Turns a whitelisted draft into the exact
// on-chain launch parameters and verifies readiness BEFORE any SOL is spent — the
// guard against repeating the LOOP launch (no dev-buy, placeholder logo, no links).
// Read-only here; the actual mint (a separate, SOL-spending step) consumes a plan
// that passed preflight.

const DEFAULT_DEV_BUY_SOL = 0.05;

/** The fixed seed dev-buy (SOL) the platform funds at each approved launch. */
export function prelaunchDevBuySol(): number {
  const raw = Number(process.env.PRELAUNCH_DEV_BUY_SOL ?? process.env.LOOP_DEV_BUY_SOL);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DEV_BUY_SOL;
}

export interface LaunchPlan {
  /** The founder/creator wallet (gets their fee share + steering; NOT the on-chain creator). */
  wallet: string;
  name: string;
  ticker: string;
  prompt: string;
  /** Seed dev-buy in SOL, funded by the platform launch wallet. */
  devBuySol: number;
  tokenImageUrl: string | null;
  bannerUrl: string | null;
  feeFounderPct: number | null;
  status: string;
  projectKey: string | null;
}

/** Build the launch plan from a wallet's draft, or null if it has none. */
export async function resolveDraftLaunch(wallet: string): Promise<LaunchPlan | null> {
  const d = await getPrelaunch(wallet);
  if (!d) return null;
  return {
    wallet,
    name: d.name,
    ticker: d.ticker,
    prompt: d.prompt ?? d.name,
    devBuySol: prelaunchDevBuySol(),
    tokenImageUrl: d.tokenImageUrl,
    bannerUrl: d.bannerUrl,
    feeFounderPct: d.feeFounderPct,
    status: d.status,
    projectKey: d.projectKey,
  };
}

/** The platform launch signer's pubkey (the wallet that pays create + dev-buy). */
export async function launchSignerPubkey(): Promise<string | null> {
  const bytes = parseSecretKeyJson(process.env.LAUNCH_SIGNER_SECRET);
  if (!bytes) return null;
  const { Keypair } = await import("@solana/web3.js");
  return Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey.toBase58();
}

/** Unclaimed vanity keypairs for a suffix (the "…Loop" pool). */
export async function availableVanity(suffix: string): Promise<number> {
  const sb = supabaseAdmin;
  if (!sb) return 0;
  const { count } = await sb
    .from("vanity_keypairs")
    .select("*", { count: "exact", head: true })
    .eq("suffix", suffix)
    .eq("used", false);
  return count ?? 0;
}

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

/** Read-only readiness report for a plan — every check must pass before a live
 *  launch. Spends no SOL: it only reads config + on-chain balances. */
export async function prelaunchPreflight(plan: LaunchPlan): Promise<{ ready: boolean; checks: Check[] }> {
  const cluster = parseCluster(process.env.LAUNCH_CLUSTER);
  const suffix = process.env.MINT_VANITY_SUFFIX || "";
  const checks: Check[] = [];

  const notLaunched = plan.status !== "launched" && !plan.projectKey;
  checks.push({
    label: "Draft not already launched",
    ok: notLaunched,
    detail: plan.projectKey ? `already → ${plan.projectKey}` : `status: ${plan.status}`,
  });

  checks.push({
    label: "Launchpad provider configured",
    ok: launchpadConfigured(),
    detail: process.env.LAUNCHPAD_PROVIDER || "simulated",
  });
  checks.push({
    label: "Agent-wallet custody (Privy) configured",
    ok: agentWalletConfigured(),
    detail: agentWalletConfigured() ? "Privy keys set" : "PRIVY_APP_ID/SECRET missing",
  });
  checks.push({ label: "Mainnet cluster", ok: cluster === "mainnet", detail: cluster });

  const vanity = suffix ? await availableVanity(suffix) : -1;
  checks.push({
    label: `Vanity "${suffix || "—"}" pool`,
    ok: suffix ? vanity > 0 : true,
    detail: suffix ? `${vanity} keypair(s) available` : "no suffix (random mint)",
  });

  const signer = await launchSignerPubkey();
  const buffer = 0.02; // tx fees + rent headroom
  const needed = plan.devBuySol + buffer;
  const bal = signer ? await getSolBalance(signer, cluster) : null;
  checks.push({
    label: `Platform wallet funds dev-buy (${plan.devBuySol} SOL + fees)`,
    ok: signer != null && bal != null && bal >= needed,
    detail: signer
      ? `${signer.slice(0, 4)}…${signer.slice(-4)} · ${bal ?? "?"} SOL (need ~${needed.toFixed(3)})`
      : "LAUNCH_SIGNER_SECRET missing",
  });

  checks.push({
    label: "Token image (logo)",
    ok: true, // not fatal — falls back to a placeholder
    detail: plan.tokenImageUrl ? "uploaded ✓" : "none → placeholder",
  });

  return { ready: checks.every((c) => c.ok), checks };
}

export interface PrelaunchListItem {
  wallet: string;
  name: string;
  ticker: string;
  status: string;
  email: string | null;
  xHandle: string | null;
  prompt: string | null;
  repo: string | null;
  bannerUrl: string | null;
  tokenImageUrl: string | null;
  feeFounderPct: number | null;
  projectKey: string | null;
  createdAt: string;
}

/** Every pre-launch draft (newest first) for the admin curation panel. */
export async function listPrelaunches(limit = 100): Promise<PrelaunchListItem[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const { data } = await sb
    .from("launch_waitlist")
    .select("wallet,name,ticker,status,email,x_handle,prompt,repo,banner_url,token_image_url,fee_founder_pct,project_key,created_at")
    .not("name", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    wallet: r.wallet as string,
    name: r.name as string,
    ticker: (r.ticker as string) ?? "",
    status: (r.status as string) ?? "draft",
    email: (r.email as string) ?? null,
    xHandle: (r.x_handle as string) ?? null,
    prompt: (r.prompt as string) ?? null,
    repo: (r.repo as string) ?? null,
    bannerUrl: (r.banner_url as string) ?? null,
    tokenImageUrl: (r.token_image_url as string) ?? null,
    feeFounderPct: (r.fee_founder_pct as number) ?? null,
    projectKey: (r.project_key as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

/** Curate a draft's status (whitelist / reject) without launching. */
export async function setPrelaunchStatus(
  wallet: string,
  status: "whitelisted" | "rejected" | "draft",
): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) throw new Error("Supabase service role not configured.");
  // Never override a launched draft.
  await sb
    .from("launch_waitlist")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("wallet", wallet)
    .neq("status", "launched");
}

export interface ApproveResult {
  key: string;
  mint: string | null;
  txSig: string | null;
  agentWallet: string;
  simulated: boolean;
}

/**
 * APPROVE & MINT — the live, SOL-spending step. Mints the draft's token from the
 * Loop launch signer (so Loop is the on-chain creator → controls the creator fees,
 * never the user), with the platform-funded seed dev-buy + the uploaded image as
 * logo, provisions a FRESH per-project Privy agent wallet, writes the projects row
 * (creator_wallet = the user, for their fee share + steering), and flips the draft
 * to launched. Preflight must pass first. The status is claimed atomically
 * (draft/whitelisted → launching) so a double-click can't double-mint.
 */
export async function approvePrelaunch(wallet: string): Promise<ApproveResult> {
  const sb = supabaseAdmin;
  if (!sb) throw new Error("Supabase service role not configured.");

  const plan = await resolveDraftLaunch(wallet);
  if (!plan) throw new Error("No pre-launch draft for that wallet.");
  if (plan.status === "launched" || plan.projectKey) {
    throw new Error(`Already launched → ${plan.projectKey ?? "?"}.`);
  }
  const { ready, checks } = await prelaunchPreflight(plan);
  if (!ready) {
    throw new Error(`Preflight not ready: ${checks.filter((c) => !c.ok).map((c) => c.label).join("; ")}`);
  }

  // Atomically claim the launch (guards double-click / concurrent approval).
  const { data: claimed } = await sb
    .from("launch_waitlist")
    .update({ status: "launching", updated_at: new Date().toISOString() })
    .eq("wallet", wallet)
    .in("status", ["draft", "whitelisted"])
    .select("wallet");
  if (!claimed || claimed.length === 0) {
    throw new Error("Draft is not in a launchable state (already launching/launched).");
  }

  try {
    const cluster = parseCluster(process.env.LAUNCH_CLUSTER);
    let key = slugify(plan.ticker, plan.name);
    const { data: existing } = await sb.from("projects").select("key").eq("key", key).maybeSingle();
    if (existing) key = `${key}-${Date.now().toString(36).slice(-4)}`;

    // Fresh per-project agent wallet (Privy) — its fee share funds it.
    const agent = await provisionAgentWallet(key);

    // The uploaded token image → pump.fun logo (placeholder on any failure).
    let logo: { bytes: Uint8Array; contentType: string; filename: string } | undefined;
    if (plan.tokenImageUrl) {
      try {
        const r = await fetch(plan.tokenImageUrl);
        if (r.ok) {
          const ct = r.headers.get("content-type") || "image/png";
          logo = { bytes: new Uint8Array(await r.arrayBuffer()), contentType: ct, filename: `token.${ct.split("/")[1] || "png"}` };
        }
      } catch {
        /* fall back to the placeholder logo */
      }
    }

    const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://looplabs.fun").replace(/\/$/, "");
    const token = await createToken({
      name: plan.name,
      ticker: plan.ticker,
      prompt: plan.prompt,
      creator: wallet,
      cluster,
      devBuySol: plan.devBuySol,
      logo,
      links: { website: `${site}/token?p=${key}` },
    });

    await sb.from("projects").insert({
      key,
      name: plan.name,
      ticker: `$${plan.ticker}`,
      description: plan.prompt.slice(0, DESCRIPTION_MAX),
      official: false,
      launchpad: token.launchpad,
      // White-label by default: the project builds under the Loop-owned org.
      repo: provisionPlan(key).repo,
      cover: "neon",
      prompt: plan.prompt,
      price: 0.00003,
      market_cap: "$30K",
      liquidity: "$4K",
      holders: "1",
      volume_24h: "0 SOL",
      curve: 0.02,
      supply: "1B",
      treasury_sol: 0,
      earned_sol: 0,
      burn_per_day: "0.00 SOL/day",
      runway: "booting",
      mint: token.mint,
      treasury_wallet: token.treasuryWallet,
      network: token.cluster,
      creator_wallet: wallet,
      agent_wallet: agent.address,
      fee_founder_pct: plan.feeFounderPct,
    });

    await sb
      .from("launch_waitlist")
      .update({ status: "launched", project_key: key, updated_at: new Date().toISOString() })
      .eq("wallet", wallet);

    return { key, mint: token.mint, txSig: token.txSig, agentWallet: agent.address, simulated: token.simulated };
  } catch (e) {
    // Roll the claim back so a fixed config can retry (mint failures are pre-mint
    // for the common cases — bad config, vanity empty, RPC). createOnPumpPortal
    // itself refuses to blind-retry a maybe-landed bundle, so this won't double-mint.
    await sb
      .from("launch_waitlist")
      .update({ status: "draft", updated_at: new Date().toISOString() })
      .eq("wallet", wallet)
      .eq("status", "launching");
    throw e;
  }
}

