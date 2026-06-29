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

/** Max SOL of pre-funding spent on the opening candle (the rest stays as runway). */
function maxCandleSol(): number {
  const n = Number(process.env.PRELAUNCH_MAX_CANDLE_SOL);
  return Number.isFinite(n) && n > 0 ? n : 1;
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
      ? "project Privy wallet (candle from pre-funding)"
      : "shared platform signer (seed candle)",
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
  projectWallet: string | null;
  createdAt: string;
}

/** Every pre-launch draft (newest first) for the admin curation panel. */
export async function listPrelaunches(limit = 100): Promise<PrelaunchListItem[]> {
  const sb = supabaseAdmin;
  if (!sb) return [];
  const { data } = await sb
    .from("launch_waitlist")
    .select("wallet,name,ticker,status,email,x_handle,prompt,repo,banner_url,token_image_url,fee_founder_pct,project_key,project_wallet,created_at")
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
  // Never override a launched draft.
  await sb
    .from("launch_waitlist")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("wallet", wallet)
    .neq("status", "launched");
  if (status === "whitelisted") await provisionProjectWallet(wallet); // best-effort
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
  const { data } = await sb
    .from("launch_waitlist")
    .select("project_wallet")
    .eq("wallet", draftWallet)
    .maybeSingle();
  const existing = (data as { project_wallet?: string } | null)?.project_wallet;
  if (existing) return existing;
  try {
    const w = await provisionAgentWallet(draftWallet); // external_id keyed by proposer wallet → stable
    await sb
      .from("launch_waitlist")
      .update({ project_wallet: w.address, project_wallet_id: w.id, updated_at: new Date().toISOString() })
      .eq("wallet", draftWallet);
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
  const { data, error } = await sb
    .from("launch_waitlist")
    .update(patch)
    .eq("wallet", wallet)
    .neq("status", "launched")
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
  const { data } = await sb
    .from("launch_waitlist")
    .select("project_wallet")
    .eq("wallet", draftWallet)
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

  const { data: row } = await sb
    .from("launch_waitlist")
    .select("project_wallet, project_wallet_id")
    .eq("wallet", draftWallet)
    .maybeSingle();
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
    // website link back to Loop. The CA already ends in "Loop" (vanity pool).
    const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://looplabs.fun").replace(/\/$/, "");
    const projectUrl = `${site}/token?p=${key}`;
    const description =
      `${plan.prompt}\n\nBuilt autonomously by its AI agent on Loop — follow the build live: ${projectUrl}`.slice(
        0,
        DESCRIPTION_MAX,
      );
    const links: { website: string; twitter?: string } = { website: projectUrl };
    if (plan.xHandle) links.twitter = `https://x.com/${plan.xHandle}`;

    let token: CreateTokenResult;
    let agentAddress: string;

    if (privyCreatorEnabled()) {
      // CUSTODY: the project's own Privy wallet (provisioned at whitelist, pre-funded
      // by backers) IS the on-chain creator + treasury + agent — one wallet. The
      // candle is funded from its pre-funding, topped up from the platform if short.
      const { data: pw } = await sb
        .from("launch_waitlist")
        .select("project_wallet, project_wallet_id")
        .eq("wallet", wallet)
        .maybeSingle();
      const projectWallet = (pw as { project_wallet?: string } | null)?.project_wallet;
      const projectWalletId = (pw as { project_wallet_id?: string } | null)?.project_wallet_id;
      if (!projectWallet || !projectWalletId) {
        throw new Error("Privy-creator mode is on but this draft has no project wallet — whitelist it first.");
      }
      const reserve = 0.03; // rent + fees kept in the wallet
      const seed = prelaunchDevBuySol();
      const bal = (await getSolBalance(projectWallet, cluster)) ?? 0;
      let candle = Math.min(Math.max(0, bal - reserve), maxCandleSol());
      if (candle < seed) {
        const topUp = seed + reserve - bal;
        if (topUp > 0) await topUpFromSigner(projectWallet, topUp, cluster);
        candle = seed;
      }
      const res = await createOnPumpPortalWithPrivy(
        { name: plan.name, symbol: plan.ticker, description, logo, links, devBuySol: candle },
        cluster,
        { walletId: projectWalletId, address: projectWallet },
      );
      token = { launchpad: "Pump.fun", cluster, mint: res.mint, treasuryWallet: res.treasuryWallet, txSig: res.txSig, simulated: false };
      agentAddress = projectWallet; // creator = treasury = agent
    } else {
      // Default path: mint from the shared platform signer + a fresh per-project agent wallet.
      const agent = await provisionAgentWallet(key);
      agentAddress = agent.address;
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
      network: token.cluster,
      creator_wallet: wallet,
      agent_wallet: agentAddress,
      fee_founder_pct: plan.feeFounderPct,
    });

    await sb
      .from("launch_waitlist")
      .update({ status: "launched", project_key: key, updated_at: new Date().toISOString() })
      .eq("wallet", wallet);

    // White-label home: create the project's GitHub repo + Vercel project so its
    // agent has somewhere to build/deploy. Best-effort + env-gated — the launch is
    // the commit point; a provisioning hiccup leaves the project launched (the repo
    // can be created later), never aborts the mint.
    let provisioning: string | undefined;
    try {
      const { provisionProjectHome } = await import("./provisioning-exec");
      const home = await provisionProjectHome(key, plan.prompt);
      provisioning = home.note;
    } catch (e) {
      provisioning = e instanceof Error ? e.message : "provisioning error";
    }

    return { key, mint: token.mint, txSig: token.txSig, agentWallet: agentAddress, simulated: token.simulated, provisioning };
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

