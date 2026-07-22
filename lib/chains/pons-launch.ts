import "server-only";

// Launch a token on PONS from our own flow — no web UI, no human clicking a
// form on someone else's site. `launchToken` is a public, payable function on a
// verified contract (lib/chains/pons.ts), so this is the Hood counterpart of
// lib/pumpfun.ts: same seam, same automation, one transaction.
//
// Custody mirrors the rest of the Hood side: the transaction is signed by the
// project's Privy EVM wallet (lib/chains/hood-agent-wallet), never by a key in
// this process. Read-then-act, in order:
//
//   1. read launchFee() + launchEnabled() LIVE — the fee is owner-settable, and
//      paying a stale constant reverts (LaunchFeeNotPaid) or silently overpays
//      into a bigger dev buy;
//   2. check the wallet can actually cover fee + dev buy + gas, so we fail with
//      a sentence instead of an on-chain revert the founder has to decode;
//   3. send, wait for the receipt, and read the launched token address out of
//      the TokenLaunched log rather than guessing it.

import {
  encodeLaunchToken,
  launchValueWei,
  PONS_FACTORY,
  PONS_SELECTORS,
  type PonsTokenParams,
} from "./pons";
import { privySendEvmTx } from "./hood-agent-wallet";

const RPC = process.env.HOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.result ?? null) as T | null;
  } catch {
    return null;
  }
}

async function callFactory(selector: string): Promise<bigint | null> {
  const out = await rpc<string>("eth_call", [{ to: PONS_FACTORY, data: "0x" + selector }, "latest"]);
  if (!out || !/^0x[0-9a-fA-F]+$/.test(out)) return null;
  try {
    return BigInt(out);
  } catch {
    return null;
  }
}

/** The live protocol fee, in wei. Null when the chain is unreachable — callers
 *  must NOT fall back to a constant: launching with the wrong fee is a wasted
 *  transaction at best. */
export async function readLaunchFeeWei(): Promise<bigint | null> {
  return callFactory(PONS_SELECTORS.launchFee);
}

/** Whether Pons is currently accepting launches from non-whitelisted senders. */
export async function readLaunchEnabled(): Promise<boolean | null> {
  const v = await callFactory(PONS_SELECTORS.launchEnabled);
  return v === null ? null : v === BigInt(1);
}

export interface PonsLaunchResult {
  txHash: string;
  /** The deployed token address, read from the receipt's logs. */
  token: string | null;
  feeWei: bigint;
  devBuyWei: bigint;
}

/**
 * Deploy a token on Pons. `devBuyWei` above the protocol fee becomes the initial
 * buy, credited to `params.feeWallet` (the project treasury) — the Hood
 * equivalent of the pump.fun dev-buy that seeds the first candle.
 *
 * Throws with a human sentence on every precondition rather than letting the
 * chain revert: a failed launch still costs gas and, worse, leaves the founder
 * guessing which of six requirements bit.
 */
export async function launchOnPons(opts: {
  walletId: string;
  walletAddress: string;
  params: PonsTokenParams;
  devBuyWei?: bigint;
  /** 32-byte CREATE2 salt; random when omitted. */
  salt?: string;
}): Promise<PonsLaunchResult> {
  const devBuyWei = opts.devBuyWei ?? BigInt(0);

  const [feeWei, enabled] = await Promise.all([readLaunchFeeWei(), readLaunchEnabled()]);
  if (feeWei === null || enabled === null) {
    throw new Error("Could not read the Pons factory — Robinhood Chain RPC unreachable.");
  }
  if (!enabled) {
    throw new Error("Pons has launches disabled right now (launchEnabled = false).");
  }

  const value = launchValueWei(feeWei, devBuyWei);

  // Balance check BEFORE spending gas on a doomed transaction.
  const balHex = await rpc<string>("eth_getBalance", [opts.walletAddress, "latest"]);
  const balance = balHex ? BigInt(balHex) : BigInt(0);
  if (balance <= value) {
    throw new Error(
      `Wallet ${opts.walletAddress} holds ${Number(balance) / 1e18} ETH — not enough for the ` +
        `${Number(feeWei) / 1e18} ETH fee plus a ${Number(devBuyWei) / 1e18} ETH dev buy, plus gas.`
    );
  }

  const salt = opts.salt ?? randomSalt();
  const data = encodeLaunchToken(opts.params, { salt });
  const txHash = await privySendEvmTx(opts.walletId, { to: PONS_FACTORY, valueWei: value, data });
  const token = await readLaunchedToken(txHash);
  return { txHash, token, feeWei, devBuyWei };
}

function randomSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The deployed token address, taken from the receipt. Pons emits TokenDeployed
 * and TokenLaunched, both with the token as their FIRST non-indexed word, and
 * both from the factory — so rather than hardcoding a topic hash (one more
 * constant that can be wrong), we take the first log emitted by the factory and
 * read its first data word. Null when the receipt isn't available yet; the
 * caller can still recover the address from the transaction later.
 */
export async function readLaunchedToken(txHash: string): Promise<string | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const receipt = await rpc<{
      status?: string;
      logs?: { address: string; data: string; topics: string[] }[];
    }>("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      if (receipt.status === "0x0") throw new Error(`Pons launch reverted on-chain (${txHash}).`);
      const log = (receipt.logs ?? []).find(
        (l) => l.address?.toLowerCase() === PONS_FACTORY.toLowerCase()
      );
      const word = log?.data?.slice(2, 66);
      if (word && /^[0-9a-fA-F]{64}$/.test(word)) return "0x" + word.slice(24);
      return null;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}
