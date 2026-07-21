import "server-only";

import type { LaunchCluster } from "./launchpad";
import {
  evaluateAction,
  walletFor,
  type AgentAction,
  type ActionPolicy,
  DEFAULT_POLICY,
} from "./agent-actions";

// Execution layer for the agent's on-chain actions. The pure seam (agent-actions)
// decides ALLOWED vs ESCALATE; this turns an ALLOWED buyback into a real Jupiter
// swap signed from the agent's hot wallet. Burn/airdrop are irreversible and
// always escalate in evaluateAction, so they never reach the signing path here.
//
// Env-gated on AGENT_WALLET_SECRET: until the agent's Privy hot wallet is funded
// + configured, executeBuyback returns a *simulated* plan (the live Jupiter quote)
// and signs nothing — safe to run pre-launch. Heavy libs imported dynamically.

import { parseSecretKeyJson } from "./vanity";
import { agentWalletConfigured, privySignAndSendSolanaTx } from "./agent-wallet";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
// Jupiter v6 (quote-api.jup.ag) was sunset — the host no longer resolves, so
// every fetch threw "fetch failed" and forced buybacks into the simulated/catch
// branch. Use Jupiter's current Swap API. lite-api.jup.ag is the keyless tier;
// the request/response shapes (quote: outAmount/routePlan; swap: {swapTransaction})
// are unchanged from v6, so only the base URLs move. For higher rate limits set a
// key and point JUP_BASE at api.jup.ag.
const JUP_BASE = process.env.JUP_API_BASE || "https://lite-api.jup.ag/swap/v1";
const JUP_QUOTE = `${JUP_BASE}/quote`;
const JUP_SWAP = `${JUP_BASE}/swap`;
const LAMPORTS_PER_SOL = 1_000_000_000;

/** A signer is available when either a raw hot-key OR Privy custody is set. */
export function agentExecConfigured(): boolean {
  return Boolean(process.env.AGENT_WALLET_SECRET) || agentWalletConfigured();
}

/** Pure: the Jupiter v6 quote query string for a SOL→token buyback. */
export function buildQuoteQuery(args: {
  outputMint: string;
  amountSol: number;
  slippageBps?: number;
}): string {
  const p = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: args.outputMint,
    amount: String(Math.round(args.amountSol * LAMPORTS_PER_SOL)),
    slippageBps: String(args.slippageBps ?? 100),
    swapMode: "ExactIn",
  });
  return `${JUP_QUOTE}?${p.toString()}`;
}

export interface BuybackResult {
  /** A real on-chain swap was submitted. */
  executed: boolean;
  /** Blocked or escalated by the policy gate (never signed). */
  escalated: boolean;
  /** Quote fetched but not signed (agent wallet unfunded/unconfigured). */
  simulated: boolean;
  reason: string;
  /** Expected token output (UI amount) from the Jupiter quote, when available. */
  expectedOut?: string;
  txSig?: string;
}

/** Shared exec core for buyback AND swap — both are "SOL -> outputMint via
 *  Jupiter, signed from the agent wallet", differing only in which mint and
 *  which policy-gate label. Kept private; each public fn owns its own
 *  kind-check + outputMint source so a caller can't mix them up. */
async function runJupiterSwapAction(
  action: AgentAction,
  outputMint: string,
  ctx: {
    cluster: LaunchCluster;
    policy?: ActionPolicy;
    spentTodaySol?: number;
    agentWallet?: { id: string; address: string } | null;
  }
): Promise<BuybackResult> {
  const verdict = evaluateAction(action, ctx.policy ?? DEFAULT_POLICY, ctx.spentTodaySol ?? 0);
  if (!verdict.ok) {
    return { executed: false, escalated: verdict.escalate, simulated: false, reason: verdict.reason };
  }

  const canRaw = Boolean(process.env.AGENT_WALLET_SECRET);
  const canPrivy =
    !canRaw && agentWalletConfigured() && Boolean(ctx.agentWallet?.id && ctx.agentWallet?.address);

  let expectedOut: string | undefined;
  try {
    const quote = await fetchQuote(outputMint, action.amountSol ?? 0);
    expectedOut = quote.outAmount;
    if (!canRaw && !canPrivy) {
      return {
        executed: false,
        escalated: false,
        simulated: true,
        reason: `Simulated ${action.kind} from ${walletFor(action.kind)} wallet (fund the agent wallet to execute).`,
        expectedOut,
      };
    }
    const txSig = canPrivy
      ? await signAndSubmitSwapPrivy(quote, ctx.cluster, ctx.agentWallet!)
      : await signAndSubmitSwap(quote, ctx.cluster);
    return { executed: true, escalated: false, simulated: false, reason: `${action.kind} executed.`, expectedOut, txSig };
  } catch (e) {
    return {
      executed: false,
      escalated: false,
      simulated: true,
      reason: e instanceof Error ? e.message : `${action.kind} could not be planned.`,
      expectedOut,
    };
  }
}

async function fetchQuote(outputMint: string, amountSol: number, slippageBps?: number) {
  const res = await fetch(buildQuoteQuery({ outputMint, amountSol, slippageBps }));
  if (!res.ok) throw new Error(`Jupiter quote failed (${res.status}).`);
  return (await res.json()) as { outAmount?: string; routePlan?: unknown[] };
}

/**
 * Execute a buyback of the project's own token with treasury SOL. Runs the
 * policy gate first; only an ALLOWED (non-escalated) buyback proceeds, and even
 * then it stays simulated until the agent wallet is configured.
 */
export async function executeBuyback(
  action: AgentAction,
  ctx: {
    outputMint: string;
    cluster: LaunchCluster;
    policy?: ActionPolicy;
    spentTodaySol?: number;
    /** The Privy-custodied agent wallet (id + address); enables real signing. */
    agentWallet?: { id: string; address: string } | null;
  }
): Promise<BuybackResult> {
  if (action.kind !== "buyback") {
    return { executed: false, escalated: false, simulated: false, reason: "Not a buyback." };
  }
  return runJupiterSwapAction(action, ctx.outputMint, ctx);
}

/**
 * Execute a treasury-portfolio swap: SOL -> an xStock the agent picked
 * (`action.outputMint`, its own judgment call — see lib/agent-actions.ts).
 * evaluateAction has already confirmed the mint is a verified xStock; this
 * layer just runs the same signed-Jupiter-route path buyback uses. Stays
 * simulated until the agent wallet is funded, exactly like buyback.
 */
export async function executeSwap(
  action: AgentAction,
  ctx: {
    cluster: LaunchCluster;
    policy?: ActionPolicy;
    spentTodaySol?: number;
    agentWallet?: { id: string; address: string } | null;
  }
): Promise<BuybackResult> {
  if (action.kind !== "swap") {
    return { executed: false, escalated: false, simulated: false, reason: "Not a swap." };
  }
  if (!action.outputMint) {
    return { executed: false, escalated: false, simulated: false, reason: "swap requires an outputMint." };
  }
  return runJupiterSwapAction(action, action.outputMint, ctx);
}

/** Build a Jupiter swap for `userPublicKey` → base64 VersionedTransaction. */
async function buildSwapTx(quote: unknown, userPublicKey: string): Promise<string> {
  const res = await fetch(JUP_SWAP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
    }),
  });
  if (!res.ok) throw new Error(`Jupiter swap build failed (${res.status}).`);
  const { swapTransaction } = (await res.json()) as { swapTransaction: string };
  return swapTransaction;
}

/**
 * Privy custody path: build the swap for the agent's Privy wallet, then let Privy
 * sign AND broadcast it. The raw key never touches our process.
 */
async function signAndSubmitSwapPrivy(
  quote: unknown,
  cluster: LaunchCluster,
  wallet: { id: string; address: string }
): Promise<string> {
  const swapTx = await buildSwapTx(quote, wallet.address);
  return privySignAndSendSolanaTx(
    wallet.id,
    swapTx,
    cluster === "devnet" ? "devnet" : "mainnet"
  );
}

async function signAndSubmitSwap(
  quote: unknown,
  cluster: LaunchCluster
): Promise<string> {
  const secret = parseSecretKeyJson(process.env.AGENT_WALLET_SECRET as string);
  if (!secret) throw new Error("AGENT_WALLET_SECRET must be a 64-byte JSON array.");
  const { Keypair, Connection, VersionedTransaction } = await import("@solana/web3.js");
  const signer = Keypair.fromSecretKey(Uint8Array.from(secret));

  const swapTransaction = await buildSwapTx(quote, signer.publicKey.toBase58());
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([signer]);

  const host = cluster === "devnet" ? "devnet" : "mainnet";
  const endpoint = process.env.HELIUS_API_KEY
    ? `https://${host}.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : `https://api.${cluster === "devnet" ? "devnet" : "mainnet-beta"}.solana.com`;
  const conn = new Connection(endpoint, "confirmed");
  const sig = await conn.sendTransaction(tx);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  return sig;
}
