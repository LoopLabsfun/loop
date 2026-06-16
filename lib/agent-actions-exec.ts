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

export const SOL_MINT = "So11111111111111111111111111111111111111112";
const JUP_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUP_SWAP = "https://quote-api.jup.ag/v6/swap";
const LAMPORTS_PER_SOL = 1_000_000_000;

export function agentExecConfigured(): boolean {
  return Boolean(process.env.AGENT_WALLET_SECRET);
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
  ctx: { outputMint: string; cluster: LaunchCluster; policy?: ActionPolicy; spentTodaySol?: number }
): Promise<BuybackResult> {
  if (action.kind !== "buyback") {
    return { executed: false, escalated: false, simulated: false, reason: "Not a buyback." };
  }
  const verdict = evaluateAction(action, ctx.policy ?? DEFAULT_POLICY, ctx.spentTodaySol ?? 0);
  if (!verdict.ok) {
    return { executed: false, escalated: verdict.escalate, simulated: false, reason: verdict.reason };
  }

  // Allowed. Fetch a live route either way (so the plan is real).
  let expectedOut: string | undefined;
  try {
    const quote = await fetchQuote(ctx.outputMint, action.amountSol ?? 0);
    expectedOut = quote.outAmount;
    if (!agentExecConfigured()) {
      return {
        executed: false,
        escalated: false,
        simulated: true,
        reason: `Simulated buyback from ${walletFor("buyback")} wallet (fund AGENT_WALLET_SECRET to execute).`,
        expectedOut,
      };
    }
    const txSig = await signAndSubmitSwap(quote, ctx.cluster);
    return { executed: true, escalated: false, simulated: false, reason: "Buyback executed.", expectedOut, txSig };
  } catch (e) {
    return {
      executed: false,
      escalated: false,
      simulated: true,
      reason: e instanceof Error ? e.message : "Buyback could not be planned.",
      expectedOut,
    };
  }
}

async function signAndSubmitSwap(
  quote: unknown,
  cluster: LaunchCluster
): Promise<string> {
  const secret = parseSecretKeyJson(process.env.AGENT_WALLET_SECRET as string);
  if (!secret) throw new Error("AGENT_WALLET_SECRET must be a 64-byte JSON array.");
  const { Keypair, Connection, VersionedTransaction } = await import("@solana/web3.js");
  const signer = Keypair.fromSecretKey(Uint8Array.from(secret));

  const res = await fetch(JUP_SWAP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: signer.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
    }),
  });
  if (!res.ok) throw new Error(`Jupiter swap build failed (${res.status}).`);
  const { swapTransaction } = (await res.json()) as { swapTransaction: string };
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
