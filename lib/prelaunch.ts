import "server-only";
import { supabaseAdmin } from "./supabase";
import { getPrelaunch, normalizeTicker, NAME_MAX, PROMPT_MAX, REPO_MAX } from "./waitlist";
import { makeSplit } from "./fees";
import { getSolBalance } from "./solana";
import { createToken, launchpadConfigured, parseCluster, type CreateTokenResult } from "./launchpad";
import { agentWalletConfigured, provisionAgentWallet, privySignAndSendSolanaTx } from "./agent-wallet";
import { createOnPumpPortalWithPrivy } from "./pumpfun";
import { parseSecretKeyJson } from "./vanity";
import { slugify, DESCRIPTION_MAX } from "./launch";
import { provisionPlan } from "./provisioning";
import { getRecentContributions } from "./solana";
import {
  isMeaningfulContribution,
  totalRaised,
  backerCount,
  planRefunds,
  type Contribution,
} from "./prefunding";

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

/** Whether the project's own Privy wallet is the on-chain creator/treasury at mint
 *  (vs. the shared platform signer). OFF by default — the Privy-signed create path is
 *  the one untested money path, so the founder arms it explicitly after a test launch. */
export function privyCreatorEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PRELAUNCH_PRIVY_CREATOR === "1";
}

/** Seed SOL from the platform launch signer → a project wallet, so it can pay its
 *  own create + candle when community pre-funding is short. Confirmed. */
async function topUpFromSigner(to: string, sol: number, cluster: ReturnType<typeof parseCluster>): Promise<void> {
  if (sol <= 0) return;
  const bytes = parseSecretKeyJson(process.env.LAUNCH_SIGNER_SECRET);
  if (!bytes) throw new Error("LAUNCH_SIGNER_SECRET required to seed the candle.");
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) throw new Error("HELIUS_API_KEY required to seed the candle.");
  const { Keypair, Connection, SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } =
    await import("@solana/web3.js");
  const signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  const endpoint = `https://${cluster === "devnet" ? "devnet" : "mainnet"}.helius-rpc.com/?api-key=${heliusKey}`;
  const conn = new Connection(endpoint, "confirmed");
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: new PublicKey(to),
      lamports: Math.round(sol * LAMPORTS_PER_SOL),
    }),
  );
  const sig = await conn.sendTransaction(tx, [signer]);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
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
  /** Proposer's X handle (bare, no @) → the token's twitter link if present. */
  xHandle: string | null;
  status: string;
  projectKey: string | null;
  /** White-label home reserved + provisioned at whitelist time, if any. */
  homeKey: string | null;
  homeRepo: string | null;
  homeVercelUrl: string | null;
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
    xHandle: d.xHandle,
    status: d.status,
    projectKey: d.projectKey,
    homeKey: d.homeKey,
    homeRepo: d.homeRepo,
    homeVercelUrl: d.homeVercelUrl,
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

  checks.push({
    label: "Mint creator / treasury",
    ok: true, // informational — both paths are valid
    detail: privyCreatorEnabled()
      ? "project Privy wallet (platform-funded seed candle)"
      : "shared platform signer (seed candle)",
  });

  checks.push({
    label: "White-label home (repo + Vercel)",
    ok: true, // not fatal — approve provisions it as a fallback if whitelist didn't
    detail: plan.homeVercelUrl ? `${plan.homeRepo} · ${plan.homeVercelUrl}` : "not provisioned yet → provisioned at approve",
  });

  // Backer buy-in preview: EVERY confirmed pre-launch backer, their wallet, and
  // the exact % of the buy-in tokens they'll receive at approve (their share of
  // the pool — the pump.fun bonding-curve price at execution time decides the
  // absolute token count, but the SPLIT is fixed now and worth checking before
  // spending real SOL). Not fatal — a project can launch with zero backers.
  {
    const sb2 = supabaseAdmin;
    let backerLines: string[] = [];
    let totalBackerSol = 0;
    if (sb2) {
      const { data } = await sb2
        .from("prelaunch_contributions")
        .select("contributor_wallet, amount_sol, status")
        .eq("draft_wallet", plan.wallet)
        .eq("status", "confirmed");
      const { groupContributionsByWallet } = await import("./prefunding-distribute");
      const grouped = groupContributionsByWallet(
        ((data ?? []) as { contributor_wallet: string; amount_sol: number; status: string }[]).map((r) => ({
          contributorWallet: r.contributor_wallet,
          amountSol: Number(r.amount_sol),
          status: r.status,
        })),
      );
      totalBackerSol = grouped.reduce((s, g) => s + g.sol, 0);
      backerLines = grouped.map(
        (g) => `${g.wallet.slice(0, 4)}…${g.wallet.slice(-4)} ${g.sol} SOL (${totalBackerSol > 0 ? ((g.sol / totalBackerSol) * 100).toFixed(1) : "0"}%)`,
      );
    }
    checks.push({
      label: `Backer buy-in preview (${backerLines.length} backer${backerLines.length === 1 ? "" : "s"}, ${totalBackerSol} SOL pooled)`,
      ok: true, // informational — zero backers is a valid launch, not a blocker
      detail: backerLines.length ? backerLines.join(" · ") : "no confirmed backers yet",
    });
  }

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
  projectWallet: string | null;
  homeKey: string | null;
  homeRepo: string | null;
  homeVercelUrl: string | null;
  createdAt: string;
}

/** Every pre-launch draft (newest first) for the admin curation panel. */
export async function listPrelaunches(limit = 100): Promise<PrelaunchListItem[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const { data } = await sb
    .from("launch_waitlist")
    .select(
      "wallet,name,ticker,status,email,x_handle,prompt,repo,banner_url,token_image_url,fee_founder_pct,project_key,project_wallet,home_key,home_repo,home_vercel_url,created_at",
    )
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
    projectWallet: (r.project_wallet as string) ?? null,
    homeKey: (r.home_key as string) ?? null,
    homeRepo: (r.home_repo as string) ?? null,
    homeVercelUrl: (r.home_vercel_url as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

/** Curate a draft's status (whitelist / reject) without launching. Whitelisting
 *  also provisions the project's Loop-custodial wallet so backers can pre-fund it. */
export async function setPrelaunchStatus(
  wallet: string,
  status: "whitelisted" | "rejected" | "draft",
): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) throw new Error("Supabase service role not configured.");
  // Scoped to the wallet's ACTIVE row only — a wallet can hold past terminal rows
  // (launched/rejected) alongside the current one, and `.neq("status","launched")`
  // alone would also match a stray old "rejected" row, flipping its status too.
  await sb
    .from("launch_waitlist")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("wallet", wallet)
    .in("status", ["draft", "whitelisted", "launching"]);
  if (status === "whitelisted") {
    await provisionProjectWallet(wallet); // best-effort
    // best-effort — repo + Vercel home, ready before mint. provisionDraftHome
    // shouldn't throw, but whitelisting must never fail because a GitHub/Vercel
    // call (or a future change to that function) did something unexpected.
    try {
      await provisionDraftHome(wallet);
    } catch {
      /* the admin "Provision home" retry covers a failed/partial attempt */
    }
  }
}

/**
 * Reserve a project key + provision its white-label home (GitHub repo + Vercel
 * project) AHEAD of the mint, at whitelist time, so the agent has somewhere to
 * build from the moment it's launched and the live site URL exists to put into
 * the pump.fun token's website link (alongside the loop.fun token-page link
 * already threaded into the description). Reserves the SAME key
 * `slugify(ticker, name)` the eventual mint would otherwise compute, so
 * approvePrelaunch reuses this exact repo/Vercel project instead of a second,
 * mismatched one. Idempotent + best-effort: a GitHub/Vercel hiccup never blocks
 * whitelisting — re-run this (the admin "Provision home" retry) to pick up where
 * it left off.
 */
export async function provisionDraftHome(
  draftWallet: string,
): Promise<{ ok: boolean; note: string; key?: string; repo?: string; vercelUrl?: string }> {
  const sb = supabaseAdmin;
  if (!sb) return { ok: false, note: "no service-role client" };

  const { data: row } = await sb
    .from("launch_waitlist")
    .select("id,name,ticker,prompt,home_key,token_image_url")
    .eq("wallet", draftWallet)
    .in("status", ["draft", "whitelisted", "launching"])
    .maybeSingle();
  if (!row) return { ok: false, note: "no active draft for that wallet" };
  const r = row as {
    id: number;
    name: string | null;
    ticker: string | null;
    prompt: string | null;
    home_key: string | null;
    token_image_url: string | null;
  };
  if (!r.name || !r.ticker) return { ok: false, note: "draft is missing a name/ticker" };

  let key = r.home_key;
  if (!key) {
    key = slugify(r.ticker, r.name);
    // Collision-check against both live projects AND other drafts' already-
    // reserved keys (a live mint hasn't happened yet, so `projects` alone isn't
    // enough — two whitelisted drafts could otherwise slugify to the same name).
    const { data: existingProject } = await sb.from("projects").select("key").eq("key", key).maybeSingle();
    const { data: existingHome } = await sb
      .from("launch_waitlist")
      .select("id")
      .eq("home_key", key)
      .neq("id", r.id)
      .in("status", ["draft", "whitelisted", "launching"])
      .maybeSingle();
    if (existingProject || existingHome) key = `${key}-${Date.now().toString(36).slice(-4)}`;
    // Claim atomically (only if still unreserved) — the partial unique index on
    // home_key is the backstop against a concurrent double-claim.
    const { error: claimErr } = await sb
      .from("launch_waitlist")
      .update({ home_key: key, updated_at: new Date().toISOString() })
      .eq("id", r.id)
      .is("home_key", null);
    if (claimErr) return { ok: false, note: `key reservation failed: ${claimErr.message}` };
  }

  const { provisionProjectHome } = await import("./provisioning-exec");
  const home = await provisionProjectHome(key, {
    name: r.name,
    ticker: r.ticker,
    description: r.prompt ?? r.name,
    tokenImageUrl: r.token_image_url,
  });
  const plan = provisionPlan(key);
  // Only record a URL/repo that's actually real. `plan.vercelUrl` is just a guess
  // (`<name>.vercel.app` lives in a global namespace and is essentially always
  // already taken by someone else — Vercel assigns a randomized alias instead);
  // `home.vercelUrl` is the REAL one resolved after the first deploy went READY.
  // A created-but-undeployed Vercel project also serves nothing — linking the
  // repo doesn't itself trigger a build, only a fresh push does — so this is
  // gated on the first deploy actually firing, not just the project existing.
  // Either way, a wrong/dead URL would go straight into the pump.fun website
  // link for traders.
  if (home.repoOk || home.vercelOk) {
    const patch: Record<string, unknown> = { home_provisioned_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (home.repoOk) patch.home_repo = plan.repo;
    if (home.vercelOk && home.deployOk && home.vercelUrl) patch.home_vercel_url = home.vercelUrl;
    await sb.from("launch_waitlist").update(patch).eq("id", r.id);
  }
  return {
    ok: home.repoOk && home.vercelOk && home.deployOk,
    note: home.note,
    key,
    repo: home.repoOk ? plan.repo : undefined,
    vercelUrl: home.vercelOk && home.deployOk ? home.vercelUrl : undefined,
  };
}

/**
 * Provision the project's Loop-custodial Privy wallet at WHITELIST time (gating on
 * admin curation, not raw drafts, avoids spam wallets). This wallet becomes the
 * on-chain creator/treasury at mint; backers pre-fund it meanwhile. Keyed by the
 * proposer wallet so it stays stable across the eventual project key. Idempotent +
 * best-effort: a Privy hiccup never blocks whitelisting. Returns the address or null.
 */
export async function provisionProjectWallet(draftWallet: string): Promise<string | null> {
  const sb = supabaseAdmin;
  if (!sb || !agentWalletConfigured()) return null;
  // Scoped to the wallet's ACTIVE row — a wallet can hold past terminal rows
  // (launched/rejected) alongside the current one; unscoped this would crash on
  // an ambiguous multi-row match or, worse, silently provision against the wrong
  // historical row.
  const { data } = await sb
    .from("launch_waitlist")
    .select("project_wallet")
    .eq("wallet", draftWallet)
    .in("status", ["draft", "whitelisted", "launching"])
    .maybeSingle();
  const existing = (data as { project_wallet?: string } | null)?.project_wallet;
  if (existing) return existing;
  try {
    const w = await provisionAgentWallet(draftWallet); // external_id keyed by proposer wallet → stable
    await sb
      .from("launch_waitlist")
      .update({ project_wallet: w.address, project_wallet_id: w.id, updated_at: new Date().toISOString() })
      .eq("wallet", draftWallet)
      .in("status", ["draft", "whitelisted", "launching"]);
    return w.address;
  } catch {
    return null;
  }
}

export interface DraftFieldPatch {
  name?: string | null;
  ticker?: string | null;
  prompt?: string | null;
  repo?: string | null;
  feeFounderPct?: number | null;
}

/**
 * Edit a pre-launch draft's mutable fields, BEFORE it launches. Used by both the
 * platform admin (any draft) and the creator (their own draft, via a signed re-edit).
 * Only keys PRESENT are touched; status, payment sigs, wallets and images are never
 * altered here. Refuses a draft that's already launched. Throws on no-op / error.
 */
export async function updatePrelaunchDraft(wallet: string, input: DraftFieldPatch): Promise<void> {
  const sb = supabaseAdmin;
  if (!sb) throw new Error("Supabase service role not configured.");
  const patch: Record<string, unknown> = {};
  if ("name" in input) {
    const v = typeof input.name === "string" ? input.name.trim().slice(0, NAME_MAX) : "";
    if (v) patch.name = v; // a draft needs a name — never blank it
  }
  if ("ticker" in input) {
    const t = normalizeTicker(input.ticker);
    if (t) patch.ticker = t;
  }
  if ("prompt" in input) {
    const v = typeof input.prompt === "string" ? input.prompt.trim().slice(0, PROMPT_MAX) : "";
    patch.prompt = v || null;
  }
  if ("repo" in input) {
    const v = typeof input.repo === "string" ? input.repo.trim().slice(0, REPO_MAX) : "";
    patch.repo = v || null;
  }
  if ("feeFounderPct" in input && input.feeFounderPct != null && Number.isFinite(Number(input.feeFounderPct))) {
    patch.fee_founder_pct = makeSplit(Number(input.feeFounderPct)).founderPct;
  }
  if (!Object.keys(patch).length) throw new Error("No editable fields provided.");
  patch.updated_at = new Date().toISOString();
  // Scoped to the wallet's ACTIVE row — `.neq("status","launched")` alone would
  // also match a stray old "rejected" row for this wallet, editing the wrong one.
  const { data, error } = await sb
    .from("launch_waitlist")
    .update(patch)
    .eq("wallet", wallet)
    .in("status", ["draft", "whitelisted", "launching"])
    .select("wallet");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("No editable draft for that wallet (or already launched).");
}

/**
 * Sync on-chain pre-funding into the ledger (dedup by tx_sig). Reads SOL transfers
 * into the project wallet and records new, above-dust ones with their sender (for
 * refunds). Returns how many new contributions were recorded.
 */
export async function syncPrelaunchContributions(draftWallet: string): Promise<number> {
  const sb = supabaseAdmin;
  if (!sb) return 0;
  // Scoped to the wallet's ACTIVE row — see provisionProjectWallet for why an
  // unscoped wallet match is ambiguous once a wallet can hold multiple rows.
  const { data } = await sb
    .from("launch_waitlist")
    .select("project_wallet")
    .eq("wallet", draftWallet)
    .in("status", ["draft", "whitelisted", "launching"])
    .maybeSingle();
  const projectWallet = (data as { project_wallet?: string } | null)?.project_wallet;
  if (!projectWallet) return 0;
  const cluster = parseCluster(process.env.LAUNCH_CLUSTER);
  const onchain = await getRecentContributions(projectWallet, cluster);
  if (!onchain?.length) return 0;
  let added = 0;
  for (const c of onchain) {
    if (!c.sig || c.from === projectWallet || !isMeaningfulContribution(c.sol)) continue;
    const { error } = await sb.from("prelaunch_contributions").insert({
      draft_wallet: draftWallet,
      project_wallet: projectWallet,
      contributor_wallet: c.from,
      amount_sol: c.sol,
      tx_sig: c.sig,
      status: "confirmed",
    });
    if (!error) added++; // 23505 (tx already recorded) is the expected dedup no-op
  }
  return added;
}

export interface PrelaunchFunding {
  projectWallet: string | null;
  totalSol: number;
  backers: number;
  contributions: { contributorWallet: string; amountSol: number; txSig: string; status: string; at: string }[];
}

/** The pre-funding ledger for a draft (admin view): wallet, total still backing it,
 *  distinct backers, and the per-contribution rows. */
export async function getPrelaunchFunding(draftWallet: string): Promise<PrelaunchFunding> {
  const sb = supabaseAdmin;
  const empty: PrelaunchFunding = { projectWallet: null, totalSol: 0, backers: 0, contributions: [] };
  if (!sb) return empty;
  const { data: row } = await sb
    .from("launch_waitlist")
    .select("project_wallet")
    .eq("wallet", draftWallet)
    .in("status", ["draft", "whitelisted", "launching"])
    .maybeSingle();
  const projectWallet = (row as { project_wallet?: string } | null)?.project_wallet ?? null;
  const { data } = await sb
    .from("prelaunch_contributions")
    .select("contributor_wallet, amount_sol, tx_sig, status, created_at")
    .eq("draft_wallet", draftWallet)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Record<string, unknown>[];
  const ledger: Contribution[] = rows.map((r) => ({
    contributorWallet: r.contributor_wallet as string,
    amountSol: Number(r.amount_sol),
    txSig: r.tx_sig as string,
    status: (r.status as string) ?? "confirmed",
  }));
  return {
    projectWallet,
    totalSol: totalRaised(ledger),
    backers: backerCount(ledger),
    contributions: ledger.map((c, i) => ({ ...c, at: rows[i].created_at as string })),
  };
}

export interface RefundOutcome {
  ok: boolean;
  refunded: { to: string; sol: number; sig: string }[];
  skipped: string[];
  note: string;
}

/** Whether refund EXECUTION is armed (it moves real SOL out of the project wallet). */
export function prelaunchRefundsArmed(env: Record<string, string | undefined> = process.env): boolean {
  return env.PRELAUNCH_REFUNDS === "1";
}

/**
 * Refund a rejected/abandoned draft's backers — send each their confirmed pre-funding
 * back from the project's Privy wallet, then mark it refunded (so it's never re-sent).
 * Makes the "refundable until launch" promise real. DISARMED unless PRELAUNCH_REFUNDS=1
 * (real SOL moves); never throws — returns a note the caller surfaces.
 */
export async function refundPrelaunch(draftWallet: string): Promise<RefundOutcome> {
  const sb = supabaseAdmin;
  const out = (note: string): RefundOutcome => ({ ok: false, refunded: [], skipped: [], note });
  if (!sb) return out("no service-role client");
  if (!prelaunchRefundsArmed()) return out("refunds disarmed (set PRELAUNCH_REFUNDS=1)");
  if (!agentWalletConfigured()) return out("Privy custody not configured");

  // Never refund a launched row's wallet; a wallet can otherwise hold several
  // non-launched rows over time (e.g. an old rejected pitch plus a fresh draft),
  // so take the most recent rather than an unscoped `.maybeSingle()` (which throws
  // once more than one row matches).
  const { data: rows } = await sb
    .from("launch_waitlist")
    .select("project_wallet, project_wallet_id")
    .eq("wallet", draftWallet)
    .neq("status", "launched")
    .order("created_at", { ascending: false })
    .limit(1);
  const row = rows?.[0] ?? null;
  const projectWallet = (row as { project_wallet?: string } | null)?.project_wallet;
  const walletId = (row as { project_wallet_id?: string } | null)?.project_wallet_id;
  if (!projectWallet || !walletId) return out("no project wallet provisioned for this draft");

  const { data } = await sb
    .from("prelaunch_contributions")
    .select("contributor_wallet, amount_sol, tx_sig, status")
    .eq("draft_wallet", draftWallet);
  const ledger: Contribution[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    contributorWallet: r.contributor_wallet as string,
    amountSol: Number(r.amount_sol),
    txSig: r.tx_sig as string,
    status: (r.status as string) ?? "confirmed",
  }));
  const plan = planRefunds(ledger);
  if (!plan.length) return { ok: true, refunded: [], skipped: [], note: "nothing to refund" };

  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) return out("HELIUS_API_KEY missing");
  const cluster = parseCluster(process.env.LAUNCH_CLUSTER);
  const { Connection, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
  const endpoint = `https://${cluster === "devnet" ? "devnet" : "mainnet"}.helius-rpc.com/?api-key=${heliusKey}`;
  const conn = new Connection(endpoint, "confirmed");

  const refunded: RefundOutcome["refunded"] = [];
  const skipped: string[] = [];
  for (const r of plan) {
    try {
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction();
      tx.feePayer = new PublicKey(projectWallet);
      tx.recentBlockhash = blockhash;
      tx.add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(projectWallet),
          toPubkey: new PublicKey(r.to),
          lamports: Math.round(r.sol * LAMPORTS_PER_SOL),
        }),
      );
      // Privy holds the key: hand it the unsigned tx (base64) to sign + broadcast.
      const b64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
      const sig = await privySignAndSendSolanaTx(walletId, b64, cluster);
      // Mark this backer's confirmed contributions refunded BEFORE moving on so a
      // mid-loop failure can't double-refund.
      await sb
        .from("prelaunch_contributions")
        .update({ status: "refunded" })
        .eq("draft_wallet", draftWallet)
        .eq("contributor_wallet", r.to)
        .eq("status", "confirmed");
      refunded.push({ to: r.to, sol: r.sol, sig });
    } catch (e) {
      skipped.push(`${r.to.slice(0, 4)}…: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return {
    ok: true,
    refunded,
    skipped,
    note: `refunded ${refunded.reduce((s, x) => s + x.sol, 0)} SOL to ${refunded.length} backer(s)`,
  };
}

export interface ApproveResult {
  key: string;
  mint: string | null;
  txSig: string | null;
  agentWallet: string;
  simulated: boolean;
  /** White-label home provisioning note (repo + Vercel), when armed. */
  provisioning?: string;
  /** pump.fun native fee-sharing setup note, when armed (PUMP_FEE_SHARING=1). */
  feeSharing?: string;
  /** Backer buy-in + token distribution note (lib/prefunding-distribute.ts). */
  backers?: string;
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
    // Reuse the key reserved (+ provisioned: repo/Vercel home) at whitelist time
    // so the mint lands on the SAME repo/site the agent may already be sitting in
    // — recomputing a fresh slug here would mint into a project key that doesn't
    // match the already-live home. Falls back to a fresh slug for older drafts
    // that whitelisted before home-provisioning existed (or never got a key).
    let key = plan.homeKey;
    if (key) {
      const { data: taken } = await sb.from("projects").select("key").eq("key", key).maybeSingle();
      if (taken) key = null; // reserved key got raced by something else — fall through
    }
    if (!key) {
      key = slugify(plan.ticker, plan.name);
      const { data: existing } = await sb.from("projects").select("key").eq("key", key).maybeSingle();
      if (existing) key = `${key}-${Date.now().toString(36).slice(-4)}`;
    }

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

    // Every launch carries its full identity to pump.fun: real logo, a description
    // that ALWAYS references the project's Loop page, the proposer's socials, and a
    // website link. The CA already ends in "Loop" (vanity pool).
    const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://looplabs.fun").replace(/\/$/, "");
    const projectUrl = `${site}/token?p=${key}`;
    // Reserve room for the Loop link FIRST, then truncate the pitch to fit —
    // slicing the whole concatenated string instead would silently drop the
    // suffix (link included) for any pitch longer than ~90 chars, since
    // DESCRIPTION_MAX (200) counts the pitch + suffix together. A long pitch
    // (the common case — MEMEFORGE's is 470+ chars) would otherwise ship with
    // NO Loop link at all, contradicting the "always references the Loop page"
    // promise above.
    const followSuffix = `\n\nBuilt autonomously by its AI agent on Loop — follow the build live: ${projectUrl}`;
    const promptBudget = Math.max(0, DESCRIPTION_MAX - followSuffix.length);
    const truncatedPrompt =
      plan.prompt.length > promptBudget ? `${plan.prompt.slice(0, Math.max(0, promptBudget - 1))}…` : plan.prompt;
    const description = `${truncatedPrompt}${followSuffix}`.slice(0, DESCRIPTION_MAX);
    // The pump.fun "website" field only fits one URL — prefer the project's own
    // live site (provisioned at whitelist time) so traders land on the actual
    // product, while the loop.fun token page stays reachable via the description
    // link above (in addition to, not instead of).
    const links: { website: string; twitter?: string } = { website: plan.homeVercelUrl || projectUrl };
    if (plan.xHandle) links.twitter = `https://x.com/${plan.xHandle}`;

    // The project's own Loop-custodial wallet (provisioned at whitelist time,
    // regardless of creator mode) — the backer buy-in/distribution step below
    // needs it either way, so it's fetched once up front rather than only
    // inside the privy-creator branch.
    const { data: pwRow } = await sb
      .from("launch_waitlist")
      .select("project_wallet, project_wallet_id")
      .eq("wallet", wallet)
      .maybeSingle();
    const projectWallet = (pwRow as { project_wallet?: string } | null)?.project_wallet ?? null;
    const projectWalletId = (pwRow as { project_wallet_id?: string } | null)?.project_wallet_id ?? null;

    let token: CreateTokenResult;
    let agentAddress: string;
    // Whoever ends up as the on-chain creator — captured here (default path
    // reuses LAUNCH_SIGNER_SECRET; privy-creator path reuses the project's own
    // Privy wallet) so the fee-sharing setup below can sign as the creator
    // without re-deriving which mode was used.
    let creatorSigner: { secretKey: Uint8Array } | { privyWalletId: string; address: string } | null = null;

    if (privyCreatorEnabled()) {
      // CUSTODY: the project's own Privy wallet IS the on-chain creator +
      // treasury + agent — one wallet. The seed candle is ALWAYS platform money
      // (topped up here if the wallet's balance is short), never backer
      // pre-funding — backer SOL is deliberately left untouched so the buy-in/
      // distribution step below can attribute 100% of its OWN, separate buy to
      // backers unambiguously (mixing the two into one buy would make it
      // impossible to say which tokens came from whose money).
      if (!projectWallet || !projectWalletId) {
        throw new Error("Privy-creator mode is on but this draft has no project wallet — whitelist it first.");
      }
      const reserve = 0.03; // rent + fees kept in the wallet
      const seed = prelaunchDevBuySol();
      const bal = (await getSolBalance(projectWallet, cluster)) ?? 0;
      if (bal < seed + reserve) {
        await topUpFromSigner(projectWallet, seed + reserve - bal, cluster);
      }
      const res = await createOnPumpPortalWithPrivy(
        { name: plan.name, symbol: plan.ticker, description, logo, links, devBuySol: seed },
        cluster,
        { walletId: projectWalletId, address: projectWallet },
      );
      token = { launchpad: "Pump.fun", cluster, mint: res.mint, treasuryWallet: res.treasuryWallet, txSig: res.txSig, simulated: false };
      agentAddress = projectWallet; // creator = treasury = agent
      creatorSigner = { privyWalletId: projectWalletId, address: projectWallet };
    } else {
      // Default path: mint from the shared platform signer + a fresh per-project agent wallet.
      const agent = await provisionAgentWallet(key);
      agentAddress = agent.address;
      const { loadLaunchSignerSecret } = await import("./pump-fee-sharing");
      const signerSecret = loadLaunchSignerSecret(process.env.LAUNCH_SIGNER_SECRET);
      if (signerSecret) creatorSigner = { secretKey: signerSecret };
      token = await createToken({
        name: plan.name,
        ticker: plan.ticker,
        prompt: plan.prompt,
        description,
        creator: wallet,
        cluster,
        devBuySol: plan.devBuySol,
        logo,
        links,
      });
    }

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
      // The ACTUAL on-chain pump.fun creator the fees accrue to — the shared
      // LAUNCH_SIGNER pubkey in the default path, or this project's own Privy
      // wallet in privy-creator mode (token.treasuryWallet is exactly that
      // address either way). Without this, the cron's fee-claim grouping
      // (`feeCreatorWallet === signerPubkey`) silently excludes this project
      // from attribution the moment its fees get swept — its traders' fees
      // would be attributed to OTHER projects sharing the same signer instead
      // of credited here. Every existing project (loop/ploop/fame/build)
      // already has this set; without it, a freshly minted project starts
      // with NULL and needs the same manual DB fix-up after the fact.
      fee_creator_wallet: token.treasuryWallet,
      network: token.cluster,
      creator_wallet: wallet,
      agent_wallet: agentAddress,
      fee_founder_pct: plan.feeFounderPct,
      // Carry the draft's uploaded brand into the live row so the landing card,
      // token page, and profile render the real logo/banner (not a placeholder).
      token_image_url: plan.tokenImageUrl,
      banner_url: plan.bannerUrl,
    });

    // Scoped to the row this call just atomically claimed into "launching" —
    // an unscoped `.eq("wallet", wallet)` would also flip any of the wallet's
    // OTHER rows (a past launched/rejected pitch) to launched + this new
    // project_key, silently rewriting that row's history. This is the other half
    // of the MemeForge/FAME mixup: a repeat founder approving their second
    // project must never touch their first project's already-launched record.
    await sb
      .from("launch_waitlist")
      .update({ status: "launched", project_key: key, updated_at: new Date().toISOString() })
      .eq("wallet", wallet)
      .eq("status", "launching");

    // White-label home: create the project's GitHub repo + Vercel project so its
    // agent has somewhere to build/deploy. Usually a no-op here — provisionDraftHome
    // already did this at whitelist time against the same `key` — but idempotent
    // (createProjectRepo/createVercelProject treat "already exists" as success), so
    // it's also the fallback for drafts that whitelisted before this existed or
    // whose whitelist-time provisioning failed. Best-effort + env-gated: a
    // provisioning hiccup leaves the project launched (the repo can be created
    // later), never aborts the mint.
    let provisioning: string | undefined;
    try {
      const { provisionProjectHome } = await import("./provisioning-exec");
      const home = await provisionProjectHome(key, {
        name: plan.name,
        ticker: plan.ticker,
        description: plan.prompt,
        tokenImageUrl: plan.tokenImageUrl,
      });
      provisioning = home.note;
    } catch (e) {
      provisioning = e instanceof Error ? e.message : "provisioning error";
    }

    // Native fee-sharing (pump.fun's own on-chain split, see lib/pump-fee-sharing.ts):
    // opt the mint in and permanently fix the founder/agent/platform shares, so
    // fees route exactly per-mint instead of through the shared-signer
    // attribute-by-volume pipeline. Best-effort + env-gated (PUMP_FEE_SHARING) —
    // a failure here never blocks the mint; the admin "Configure fee-sharing"
    // retry (mirrors "Provision home") covers it.
    let feeSharing: string | undefined;
    if (!token.simulated && token.mint && creatorSigner) {
      try {
        const { buildShareholders, setupFeeSharing } = await import("./pump-fee-sharing");
        const built = buildShareholders(
          { founderWallet: wallet, agentWallet: agentAddress, platformWallet: process.env.PLATFORM_WALLET },
          plan.feeFounderPct,
        );
        if (built.ok) {
          const setup = await setupFeeSharing({
            mint: token.mint,
            creator: creatorSigner,
            shareholders: built.shareholders,
            cluster,
          });
          feeSharing = setup.note;
          if (setup.ok) {
            await sb
              .from("projects")
              .update({ fee_sharing_configured_at: new Date().toISOString(), fee_sharing_note: setup.note })
              .eq("key", key);
          }
        } else {
          feeSharing = built.error;
        }
      } catch (e) {
        feeSharing = e instanceof Error ? e.message : "fee-sharing setup error";
      }
    }

    // Backer token distribution (lib/prefunding-distribute.ts): backers voted
    // with SOL pre-launch — that money must come back to them as tokens, not
    // sit in the project's wallet as if the project itself had bought it. Runs
    // regardless of creator mode (both always have a project_wallet from
    // whitelist time). Best-effort: a failure here leaves the SOL + the
    // "confirmed" contribution rows untouched for manual follow-up rather than
    // losing track of whose money it was.
    let backers: string | undefined;
    if (!token.simulated && token.mint && projectWallet && projectWalletId) {
      try {
        const { distributeBackerTokens } = await import("./prefunding-distribute");
        const dist = await distributeBackerTokens({
          draftWallet: wallet,
          projectWallet,
          projectWalletId,
          mint: token.mint,
          cluster,
        });
        backers = dist.note;
      } catch (e) {
        backers = e instanceof Error ? e.message : "backer distribution error";
      }
    }

    return { key, mint: token.mint, txSig: token.txSig, agentWallet: agentAddress, simulated: token.simulated, provisioning, feeSharing, backers };
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

