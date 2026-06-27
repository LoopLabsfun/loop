import "server-only";
import { supabaseAdmin } from "./supabase";
import { getPrelaunch } from "./waitlist";
import { getSolBalance } from "./solana";
import { launchpadConfigured, parseCluster } from "./launchpad";
import { agentWalletConfigured } from "./agent-wallet";
import { parseSecretKeyJson } from "./vanity";

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
