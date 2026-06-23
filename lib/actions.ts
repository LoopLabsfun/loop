"use server";

import { supabase, supabaseAdmin } from "./supabase";
import type { LaunchInput, LaunchResult } from "./api";
import { sanitizeLaunch, slugify, DESCRIPTION_MAX } from "./launch";
import { provisionPlan } from "./provisioning";
import { createToken, parseCluster } from "./launchpad";
import { verifyLaunchProof, verifyDirectiveProof, type LaunchProof } from "./signature";
import {
  sanitizeDirectiveText,
  isSuspiciousDirective,
  isAbusiveDirective,
  proposalQuorum,
} from "./directives";
import { launchesOpen, LAUNCHES_CLOSED_MESSAGE } from "./launch-config";
import { toBaseUnits, chatBasePrice, TOKEN_DECIMALS } from "./chat";

/**
 * Persist a newly launched project.
 *
 * In simulated mode (no LAUNCHPAD_PROVIDER configured) `createToken` is a no-op
 * — no mint/treasury wallet — so the row is inserted with the anon client and
 * stays within the locked-down `projects` RLS insert policy. With a real
 * provider configured, the token is minted on-chain and the resulting
 * mint/treasury_wallet are persisted via the service-role client (which the
 * anon insert policy forbids).
 *
 * Pay-to-launch (no stake toll): the bonding-curve buy is the cost and seeds
 * the treasury — there's no LOOP holding to verify. Still TODO for real launch:
 * collect the launch payment / curve buy on-chain before minting.
 */
export async function launchProjectAction(
  input: LaunchInput
): Promise<LaunchResult> {
  // Phase A (LOOP-only): public launches are closed. The founder creates LOOP
  // via the service-role launch script, not this action, so this never blocks
  // the LOOP mainnet deploy. Authoritative gate (the UI also reflects it, and
  // RLS forbids anon inserts) — reopen with NEXT_PUBLIC_LAUNCHES_OPEN=true.
  if (!launchesOpen()) {
    throw new Error(LAUNCHES_CLOSED_MESSAGE);
  }

  const clean = sanitizeLaunch(input);
  const ticker = "$" + clean.ticker;
  let key = slugify(clean.ticker, clean.name);

  // Wallet ownership proof. If the client supplied a signature it MUST verify
  // (a forged/replayed one is rejected); the verified pubkey is recorded as the
  // creator. Absent proof is allowed in prototype mode — wallets that can't
  // signMessage still launch — and will become required alongside on-chain
  // launch-payment verification.
  let creatorWallet: string | null = null;
  if (input.proof) {
    if (!verifyLaunchProof(input.proof, clean.ticker)) {
      throw new Error("Wallet signature could not be verified. Please retry.");
    }
    creatorWallet = input.proof.pubkey;
  }

  // The UI network switch selects the cluster; fall back to LAUNCH_CLUSTER.
  const cluster = input.network ?? parseCluster(process.env.LAUNCH_CLUSTER);

  // Pay-to-launch (not stake-to-launch): launching is open to anyone — no
  // LOOP-holding toll. The pump.fun bonding-curve buy is the cost and seeds the
  // project treasury; Loop earns via its 5% of the creator-fee split. Holding
  // LOOP is a governance + boost (default model tier), never a gate to publish.

  // Mint the token (no-op in simulated mode).
  const token = await createToken({
    name: clean.name,
    ticker: clean.ticker,
    prompt: clean.prompt,
    cluster,
  });

  const result: LaunchResult = {
    key,
    ticker,
    launchpad: token.launchpad,
    mint: token.mint,
    network: token.cluster,
  };

  if (!supabase) return result;

  // A real launch writes a mint/treasury_wallet, which the anon insert policy
  // rejects — those must go through the service-role client.
  const db = token.mint ? supabaseAdmin : supabase;
  if (token.mint && !supabaseAdmin) {
    throw new Error(
      "Real launch requires SUPABASE_SERVICE_ROLE_KEY to persist the mint."
    );
  }

  // Avoid colliding with an existing key.
  const { data: existing } = await db!
    .from("projects")
    .select("key")
    .eq("key", key)
    .maybeSingle();
  if (existing) {
    key = `${key}-${Date.now().toString(36).slice(-4)}`;
    result.key = key;
  }

  await db!.from("projects").insert({
    key,
    name: clean.name,
    ticker,
    description: clean.prompt.slice(0, DESCRIPTION_MAX),
    official: false,
    launchpad: token.launchpad,
    // White-label by default: no personal repo supplied ⇒ the project builds
    // under the Loop-owned org (LoopLabsfun/<slug>), never the operator's account.
    repo: clean.repo || provisionPlan(key).repo,
    cover: "neon",
    prompt: clean.prompt,
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
    // Real-launch fields; null/default in simulated mode (RLS-safe).
    mint: token.mint,
    treasury_wallet: token.treasuryWallet,
    network: token.cluster,
    creator_wallet: creatorWallet,
    // Founder's creator-fee share (agent gets the rest after the 5% platform cut).
    fee_founder_pct: clean.feeFounderPct,
    // Deep steering: guardrails + content policy the agent rereads each cycle.
    guardrails: clean.guardrails || null,
    content_policy: clean.contentPolicy || null,
  });

  return result;
}

export interface DirectiveInput {
  projectKey: string;
  text: string;
  /** "directive" (a founder-style instruction) or "proposal" (holder vote). */
  kind?: "directive" | "proposal";
  /** Connected wallet, recorded as the author when available. */
  authorWallet?: string | null;
  /** Project holder count (string from the UI) → proportional proposal quorum. */
  holders?: string | number | null;
  /**
   * Optional ed25519 proof the author owns `authorWallet` (signs the canonical
   * directive message). Recorded as a VERIFIED author only if it checks out;
   * without it the wallet is an unproven claim and is dropped (never attributed).
   */
  proof?: LaunchProof;
  /**
   * Signature of the on-chain $LOOP transfer that paid for this steering message.
   * When present, the payment (verified on-chain) is the spam gate — mirrors paid
   * chat — and the row is written service_role + replay-guarded by `tx_sig`.
   */
  txSig?: string | null;
}

export interface DirectiveResult {
  ok: boolean;
  /** False when persistence is unavailable (the UI keeps its optimistic item). */
  persisted: boolean;
  error?: string;
}

/**
 * Persist a steering directive submitted from the Agent Console. Every submission
 * lands as an `open`, `holder`-role row with zeroed tallies (RLS-enforced), so it
 * is NEVER authoritative — the agent treats console directives as untrusted
 * suggestions, and promoting one to applied/adopted is a runtime/service_role
 * action. Two hardening rules close the spoofing/injection vector:
 *
 *  1. An author wallet is recorded (and shown) ONLY with a valid signature proof;
 *     a verified row is written via service_role (anon RLS forbids it). Without
 *     proof the wallet claim is dropped — no more forged "— <founder wallet>".
 *  2. Text matching a prompt-injection pattern is rejected outright, so the feed
 *     can't be stuffed with fake system/sign-off framing.
 */
export async function submitDirectiveAction(
  input: DirectiveInput
): Promise<DirectiveResult> {
  const text = sanitizeDirectiveText(input.text ?? "");
  if (!text) return { ok: false, persisted: false, error: "Directive is empty." };
  if (!input.projectKey) {
    return { ok: false, persisted: false, error: "Missing project." };
  }
  if (isSuspiciousDirective(text)) {
    return {
      ok: false,
      persisted: false,
      error:
        "Directive rejected. Steer in plain language — directives can't contain wallet addresses or override instructions. On-chain actions require a signed founder action, not the console.",
    };
  }
  const kind = input.kind === "proposal" ? "proposal" : "directive";
  // Proposals resolve at a holder-proportional quorum (≈1/10, floor 3) instead of
  // an unreachable fixed number; directives don't vote.
  const quorum = kind === "proposal" ? proposalQuorum(input.holders) : undefined;

  // PAID steering: when a payment signature is supplied, the $LOOP transfer to the
  // treasury is the spam gate (same model as paid chat — pay to ask, pay to steer).
  // Verify it on-chain, derive the real amount, replay-guard, and write via
  // service_role (the verified payment — not anon RLS — authorizes the row). The
  // payment confers NO authority: attribution still needs a signature proof, and
  // founder confirm/triage remains separately creator-wallet-gated.
  const sig = (input.txSig ?? "").trim();
  if (sig) {
    if (!supabaseAdmin) return { ok: true, persisted: false };
    const { getProject } = await import("./queries");
    const project = await getProject(input.projectKey);
    if (!project?.mint || !project?.treasuryWallet) {
      return { ok: false, persisted: false, error: "This project isn't accepting paid steering yet." };
    }
    const { verifyTokenPayment } = await import("./solana");
    const required = toBaseUnits(chatBasePrice(), TOKEN_DECIMALS);
    const credited = await verifyTokenPayment(sig, {
      mint: project.mint,
      treasury: project.treasuryWallet,
      net: project.network === "devnet" ? "devnet" : "mainnet",
    });
    if (credited == null) {
      return {
        ok: false,
        persisted: false,
        error:
          "Couldn't verify your $LOOP payment on-chain. If you just paid, wait a few seconds and try again.",
      };
    }
    if (credited < required) {
      return { ok: false, persisted: false, error: "Payment is below the steering price." };
    }
    const loopPaid = Number(credited) / 10 ** TOKEN_DECIMALS;

    // Replay guard: one verified payment ⇒ one steering message.
    const { data: dup } = await supabaseAdmin
      .from("directives")
      .select("id")
      .eq("tx_sig", sig)
      .limit(1)
      .maybeSingle();
    if (dup) {
      return { ok: false, persisted: false, error: "This payment was already used for a message." };
    }

    // Attribution remains proof-gated (paying doesn't prove who you are): a verified
    // author only with a valid signature, else an unattributed holder row.
    const paidVerified =
      !!input.proof &&
      !!input.authorWallet &&
      input.proof.pubkey === input.authorWallet &&
      verifyDirectiveProof(input.proof, input.projectKey, text);

    const { error } = await supabaseAdmin.from("directives").insert({
      project_key: input.projectKey,
      kind,
      text,
      role: "holder",
      status: "open",
      author_wallet: paidVerified ? input.proof!.pubkey.slice(0, 64) : null,
      verified: paidVerified,
      tx_sig: sig,
      loop_paid: loopPaid,
      ...(quorum != null ? { quorum } : {}),
    });
    if (error) return { ok: false, persisted: false, error: error.message };
    return { ok: true, persisted: true };
  }

  // No backend configured (cold/prototype) — succeed without persistence so the
  // Console's optimistic item still stands.
  if (!supabase) return { ok: true, persisted: false };

  // Auto-moderation: obvious abuse/harassment ("fuck the dev", slurs) is persisted
  // HIDDEN — kept for traceability but withheld from the public feed — via
  // service_role (anon RLS forbids hidden=true). Without an admin client we just
  // don't persist it (it never lands publicly). Genuine criticism is NOT abuse and
  // flows normally below.
  if (isAbusiveDirective(text)) {
    if (!supabaseAdmin) return { ok: true, persisted: false };
    const { error } = await supabaseAdmin.from("directives").insert({
      project_key: input.projectKey,
      kind,
      text,
      role: "holder",
      status: "open",
      author_wallet: null,
      verified: false,
      hidden: true,
      ...(quorum != null ? { quorum } : {}),
    });
    if (error) return { ok: false, persisted: false, error: error.message };
    return { ok: true, persisted: true };
  }

  // Verified author: the signature proves ownership of authorWallet. Only then do
  // we attribute the directive — and only via service_role, since anon RLS forbids
  // a non-null author or verified=true (that's what blocks REST spoofing).
  const verified =
    !!input.proof &&
    !!input.authorWallet &&
    input.proof.pubkey === input.authorWallet &&
    verifyDirectiveProof(input.proof, input.projectKey, text);

  if (verified && supabaseAdmin) {
    const { error } = await supabaseAdmin.from("directives").insert({
      project_key: input.projectKey,
      kind,
      text,
      role: "holder",
      status: "open",
      author_wallet: input.proof!.pubkey.slice(0, 64),
      verified: true,
      ...(quorum != null ? { quorum } : {}),
    });
    if (error) return { ok: false, persisted: false, error: error.message };
    return { ok: true, persisted: true };
  }

  // Unverified: anonymous, unattributed, unverified. RLS requires exactly this.
  const { error } = await supabase.from("directives").insert({
    project_key: input.projectKey,
    kind,
    text,
    role: "holder",
    status: "open",
    author_wallet: null,
    verified: false,
    ...(quorum != null ? { quorum } : {}),
  });
  if (error) return { ok: false, persisted: false, error: error.message };
  return { ok: true, persisted: true };
}

export interface VoteInput {
  /** Raw directive UUID (the UI strips the "d" feed-id prefix before calling). */
  directiveId: string;
  /** Connected wallet — one vote per wallet per proposal (re-voting flips side). */
  voter: string;
  dir: "for" | "against";
}

export interface VoteResult {
  ok: boolean;
  /** New tallies after the vote, echoed back so the UI shows the real counts. */
  forVotes?: number;
  againstVotes?: number;
  error?: string;
}

/**
 * Persist a holder vote on a proposal. Routes through the `cast_directive_vote`
 * RPC (the single, SECURITY DEFINER write path): it dedupes by wallet, flips the
 * side on re-vote, and recomputes the cached for/against tallies — so a vote
 * survives a refresh instead of living only in React state (the old bug).
 */
export async function castVoteAction(input: VoteInput): Promise<VoteResult> {
  if (!input.directiveId || !input.voter) {
    return { ok: false, error: "Connect a wallet to vote." };
  }
  if (input.dir !== "for" && input.dir !== "against") {
    return { ok: false, error: "Invalid vote." };
  }
  // The RPC is service_role-only (SECURITY DEFINER, not exposed to anon — keeps
  // the security advisors clean). This "use server" action is the trusted call
  // site, so it routes through the admin client.
  if (!supabaseAdmin) return { ok: false, error: "Voting is unavailable right now." };

  const { data, error } = await supabaseAdmin.rpc("cast_directive_vote", {
    p_directive_id: input.directiveId,
    p_voter: input.voter.slice(0, 64),
    p_dir: input.dir,
  });
  if (error) return { ok: false, error: error.message };

  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    forVotes: row?.for_votes ?? 0,
    againstVotes: row?.against_votes ?? 0,
  };
}

export interface ModerateInput {
  projectKey: string;
  /** Raw directive UUID (the UI strips the "d" feed-id prefix before calling). */
  directiveId: string;
  /** The acting wallet — must match the project's creator_wallet (founder). */
  moderatorWallet: string;
  /** true = hide from the public feed, false = restore. */
  hidden: boolean;
}

/**
 * Founder moderation: hide (or restore) a directive/proposal from the public feed.
 * Hiding is non-destructive (the row stays in the table) and reversible.
 *
 * Authorization is **prototype-grade**: it checks the acting wallet equals the
 * project's stored `creator_wallet`, but doesn't yet require a signed proof of
 * that wallet. Harden it by gating on an ed25519 signature like
 * submitDirectiveAction already does (the wallet can sign — see signLaunchProof).
 * It only toggles visibility — it never moves funds or changes the mandate — so
 * the blast radius of a spoof is a hidden/visible message, not value.
 */
export async function moderateDirectiveAction(
  input: ModerateInput
): Promise<{ ok: boolean; error?: string }> {
  if (!input.projectKey || !input.directiveId || !input.moderatorWallet) {
    return { ok: false, error: "Missing moderation parameters." };
  }
  if (!supabaseAdmin) return { ok: false, error: "Moderation is unavailable right now." };

  // Founder gate: the acting wallet must be the project's creator wallet.
  const { data: proj, error: projErr } = await supabaseAdmin
    .from("projects")
    .select("creator_wallet")
    .eq("key", input.projectKey)
    .maybeSingle();
  if (projErr) return { ok: false, error: projErr.message };
  const creator = (proj as { creator_wallet?: string | null } | null)?.creator_wallet;
  if (!creator || creator !== input.moderatorWallet) {
    return { ok: false, error: "Only the project founder can moderate the feed." };
  }

  const { error } = await supabaseAdmin
    .from("directives")
    .update({ hidden: input.hidden })
    .eq("id", input.directiveId)
    .eq("project_key", input.projectKey);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface ResolveInput {
  projectKey: string;
  /** Raw directive UUID (the UI strips the "d" feed-id prefix before calling). */
  directiveId: string;
  /** The acting wallet — must match the project's creator_wallet (founder). */
  moderatorWallet: string;
  /** "adopted"/"applied" = confirm (done); "declined" = reject. */
  status: "adopted" | "applied" | "declined";
}

const RESOLVE_STATUSES = new Set(["adopted", "applied", "declined"]);

/**
 * Founder resolution: mark a proposal/directive done (`adopted`/`applied`) or
 * rejected (`declined`) — the "confirm (c'est fait)" control beside "hide". The
 * counterpart to the agent's auto-resolution (resolveDueProposals): a founder can
 * close a proposal manually at any time, before or instead of a vote completing.
 *
 * Same prototype-grade founder gate as moderateDirectiveAction (acting wallet ==
 * the project's stored creator_wallet; no signature yet — the wallet adapter
 * can't require one here). Low blast radius: it only flips a status string — it
 * never moves funds. An adopted item is still just steering the agent reads as
 * untrusted data under its SECURITY floor; promote to a signed action when real
 * wallet auth lands.
 */
export async function resolveDirectiveAction(
  input: ResolveInput
): Promise<{ ok: boolean; error?: string }> {
  if (!input.projectKey || !input.directiveId || !input.moderatorWallet) {
    return { ok: false, error: "Missing parameters." };
  }
  if (!RESOLVE_STATUSES.has(input.status)) {
    return { ok: false, error: "Invalid status." };
  }
  if (!supabaseAdmin) return { ok: false, error: "Action is unavailable right now." };

  const { data: proj, error: projErr } = await supabaseAdmin
    .from("projects")
    .select("creator_wallet")
    .eq("key", input.projectKey)
    .maybeSingle();
  if (projErr) return { ok: false, error: projErr.message };
  const creator = (proj as { creator_wallet?: string | null } | null)?.creator_wallet;
  if (!creator || creator !== input.moderatorWallet) {
    return { ok: false, error: "Only the project founder can resolve proposals." };
  }

  const { error } = await supabaseAdmin
    .from("directives")
    .update({ status: input.status })
    .eq("id", input.directiveId)
    .eq("project_key", input.projectKey);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface ProposalExecInput {
  projectKey: string;
  /** Raw directive UUID (the UI strips the "d" feed-id prefix before calling). */
  directiveId: string;
  /** The acting wallet — must match the project's creator_wallet (founder). */
  moderatorWallet: string;
  /**
   * Execution-triage for an adopted proposal: 'done' (already shipped), 'todo'
   * (queued for the agent to build next), or 'refused' (founder overrides the
   * vote). null clears the triage back to "adopted, untriaged".
   */
  exec: "todo" | "done" | "refused" | null;
}

const EXEC_VALUES = new Set(["todo", "done", "refused"]);

/**
 * Founder execution-triage on an ADOPTED proposal — the Done / To-do / Refused
 * control. The vote decides adoption; this decides what the founder does with the
 * adopted ask: mark it shipped, queue it for the agent ('todo' = the agent's work
 * queue), or override the vote and refuse it. Same prototype-grade creator-wallet
 * gate as resolveDirectiveAction; only writes the `exec` string — never moves
 * funds. Only meaningful on an adopted proposal, but the gate is what protects it.
 */
export async function setProposalExecAction(
  input: ProposalExecInput
): Promise<{ ok: boolean; error?: string }> {
  if (!input.projectKey || !input.directiveId || !input.moderatorWallet) {
    return { ok: false, error: "Missing parameters." };
  }
  if (input.exec !== null && !EXEC_VALUES.has(input.exec)) {
    return { ok: false, error: "Invalid execution status." };
  }
  if (!supabaseAdmin) return { ok: false, error: "Action is unavailable right now." };

  const { data: proj, error: projErr } = await supabaseAdmin
    .from("projects")
    .select("creator_wallet")
    .eq("key", input.projectKey)
    .maybeSingle();
  if (projErr) return { ok: false, error: projErr.message };
  const creator = (proj as { creator_wallet?: string | null } | null)?.creator_wallet;
  if (!creator || creator !== input.moderatorWallet) {
    return { ok: false, error: "Only the project founder can triage proposals." };
  }

  const { error } = await supabaseAdmin
    .from("directives")
    .update({ exec: input.exec })
    .eq("id", input.directiveId)
    .eq("project_key", input.projectKey);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface ChatInput {
  projectKey: string;
  /** The sender's connected wallet (the one that paid the $LOOP). */
  wallet: string;
  question: string;
  /** Signature of the on-chain $LOOP transfer that paid for this message. */
  txSig?: string | null;
  /** $LOOP sent (base price) and the extra boost, for display + answer ordering. */
  loopPaid?: number;
  boost?: number;
}

export interface ChatResult {
  ok: boolean;
  /** False when persistence is unavailable (the UI keeps its optimistic message). */
  persisted: boolean;
  error?: string;
}

/**
 * Record a paid chat question to the project's agent. Called from the client
 * AFTER the on-chain $LOOP transfer to the treasury settles — the payment is the
 * spam gate, so the row is written service-role (anon RLS has no insert on
 * `agent_chat`). The question is screened with the SAME injection/address guard as
 * directives (it reaches the agent's brain).
 *
 * The payment is VERIFIED on-chain: we look up the transaction, confirm it
 * credited the treasury with at least the base price of $LOOP, and DERIVE
 * loop_paid/boost from what actually moved — never the client's claimed amount.
 * The signature is single-use (replay-guarded), so one payment buys one question.
 */
export async function submitChatAction(input: ChatInput): Promise<ChatResult> {
  const question = sanitizeDirectiveText(input.question ?? "");
  if (!question) return { ok: false, persisted: false, error: "Message is empty." };
  if (!input.projectKey || !input.wallet) {
    return { ok: false, persisted: false, error: "Missing project or wallet." };
  }
  if (isSuspiciousDirective(question)) {
    return {
      ok: false,
      persisted: false,
      error:
        "Message rejected — ask in plain language. No wallet addresses or override instructions; the agent can't move funds from chat.",
    };
  }

  const sig = (input.txSig ?? "").trim();
  if (!sig) return { ok: false, persisted: false, error: "Missing payment signature." };

  // Resolve the project to know where the payment must land + which token.
  const { getProject } = await import("./queries");
  const project = await getProject(input.projectKey);
  if (!project?.mint || !project?.treasuryWallet) {
    return { ok: false, persisted: false, error: "This project isn't accepting paid chat yet." };
  }

  // Verify the payment ON-CHAIN — the credited $LOOP must cover the base price;
  // derive the trusted amounts from what actually reached the treasury.
  const { verifyTokenPayment } = await import("./solana");
  const required = toBaseUnits(chatBasePrice(), TOKEN_DECIMALS);
  const credited = await verifyTokenPayment(sig, {
    mint: project.mint,
    treasury: project.treasuryWallet,
    net: project.network === "devnet" ? "devnet" : "mainnet",
  });
  if (credited == null) {
    return {
      ok: false,
      persisted: false,
      error:
        "Couldn't verify your $LOOP payment on-chain. If you just paid, wait a few seconds and try again.",
    };
  }
  if (credited < required) {
    return { ok: false, persisted: false, error: "Payment is below the message price." };
  }
  const loopPaid = Number(credited) / 10 ** TOKEN_DECIMALS;
  const boost = Math.max(0, loopPaid - chatBasePrice());

  // No backend (cold/prototype) — payment verified, just can't persist.
  if (!supabaseAdmin) return { ok: true, persisted: false };

  // Replay guard: one verified payment ⇒ one question.
  const { data: dup } = await supabaseAdmin
    .from("agent_chat")
    .select("id")
    .eq("tx_sig", sig)
    .limit(1)
    .maybeSingle();
  if (dup) {
    return { ok: false, persisted: false, error: "This payment was already used for a message." };
  }

  const { error } = await supabaseAdmin.from("agent_chat").insert({
    project_key: input.projectKey,
    wallet: input.wallet.slice(0, 64),
    question,
    loop_paid: loopPaid,
    boost,
    tx_sig: sig,
    status: "open",
  });
  if (error) return { ok: false, persisted: false, error: error.message };
  return { ok: true, persisted: true };
}
