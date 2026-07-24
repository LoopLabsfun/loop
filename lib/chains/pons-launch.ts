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

/**
 * keccak256("TokenLaunched(address,address,address,address,address,uint256,uint256,uint256,uint256,uint256)")
 *
 * `token`, `deployer` and `dexFactory` are INDEXED, so the token address lives
 * in topics[1] — NOT in the data blob. Reading data word 0 instead yields
 * `pairToken`, i.e. WETH: a launch would have been recorded with WETH as the
 * project's own mint. Verified against a real on-chain launch before trusting.
 */
const TOKEN_LAUNCHED_TOPIC0 =
  "0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a";

/** Pull (token, pool) out of a TokenLaunched log. token = topics[1] (indexed);
 *  pool = data word 1 (after pairToken). Null when the log isn't one. */
function decodeTokenLaunched(log: {
  address?: string;
  topics?: string[];
  data?: string;
}): { token: string; pool: string | null } | null {
  if (log.address?.toLowerCase() !== PONS_FACTORY.toLowerCase()) return null;
  if (log.topics?.[0]?.toLowerCase() !== TOKEN_LAUNCHED_TOPIC0) return null;
  const t = log.topics?.[1];
  if (!t || t.length < 42) return null;
  const token = "0x" + t.slice(-40);
  if (!/^0x[0-9a-fA-F]{40}$/.test(token) || /^0x0+$/.test(token)) return null;
  const data = (log.data || "").replace(/^0x/, "");
  const poolWord = data.slice(64, 128);
  const pool = /^[0-9a-fA-F]{64}$/.test(poolWord) ? "0x" + poolWord.slice(24) : null;
  return { token, pool: pool && !/^0x0+$/.test(pool) ? pool : null };
}

/**
 * The `feeWallet` baked into a launchToken call.
 *
 * This is THE irreversible parameter of a Pons launch: it receives the dev buy
 * and is wired as the locker's fee-redirect recipient, so every future trading
 * fee follows it. Decoded from the transaction's own calldata, which means it
 * reflects what was actually signed — not what a config file claims it was.
 * Null when the input isn't a launchToken call.
 */
export function decodeFeeWalletFromCalldata(input: string): string | null {
  const hex = (input || "").replace(/^0x/, "");
  if (hex.slice(0, 8).toLowerCase() !== PONS_SELECTORS.launchToken) return null;
  const args = hex.slice(8);
  let offsetBytes: number;
  try {
    offsetBytes = Number(BigInt("0x" + args.slice(0, 64)));
  } catch {
    return null;
  }
  // params is a dynamic tuple; its 6th head word is `address feeWallet`.
  const start = offsetBytes * 2 + 5 * 64;
  const word = args.slice(start, start + 64);
  if (!/^[0-9a-fA-F]{64}$/.test(word)) return null;
  const addr = "0x" + word.slice(24);
  return /^0x[0-9a-fA-F]{40}$/.test(addr) && !/^0x0+$/.test(addr) ? addr : null;
}

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
 * The deployed token address, taken from the receipt's TokenLaunched log.
 * Null when the receipt isn't available yet; the caller can still recover the
 * address from the transaction later.
 */
export async function readLaunchedToken(txHash: string): Promise<string | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const receipt = await rpc<{
      status?: string;
      logs?: { address: string; data: string; topics: string[] }[];
    }>("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      if (receipt.status === "0x0") throw new Error(`Pons launch reverted on-chain (${txHash}).`);
      for (const log of receipt.logs ?? []) {
        const decoded = decodeTokenLaunched(log);
        if (decoded) return decoded.token;
      }
      return null;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/**
 * Verify a Pons launch the USER already sent and paid for, and extract what it
 * actually created.
 *
 * This is the trust boundary of the client-paid launch path. The browser hands
 * us a transaction hash and nothing else — never a token address, never a
 * "trust me it worked". Everything is re-derived from the chain:
 *
 *   • the transaction exists and SUCCEEDED (status 0x1);
 *   • it was sent TO the Pons factory — otherwise any random transfer would
 *     "prove" a launch;
 *   • the token address comes from the factory's own log, not from the caller.
 *
 * Returns null when any of that fails, so the caller refuses the launch rather
 * than persisting a project pointing at an address nobody verified.
 */
export async function verifyPonsLaunchTx(
  txHash: string
): Promise<{ token: string; pool: string | null; from: string; feeWallet: string | null } | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const receipt = await rpc<{
      status?: string;
      to?: string | null;
      from?: string;
      logs?: { address: string; data: string; topics: string[] }[];
    }>("eth_getTransactionReceipt", [txHash]);
    if (!receipt) {
      // Not mined yet — the user sent it seconds ago. Wait rather than reject.
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (receipt.status !== "0x1") return null;
    if ((receipt.to ?? "").toLowerCase() !== PONS_FACTORY.toLowerCase()) return null;
    for (const log of receipt.logs ?? []) {
      const decoded = decodeTokenLaunched(log);
      if (decoded) {
        // Also read back the feeWallet that was actually signed.
        const tx = await rpc<{ input?: string }>("eth_getTransactionByHash", [txHash]);
        const feeWallet = tx?.input ? decodeFeeWalletFromCalldata(tx.input) : null;
        return {
          token: decoded.token,
          pool: decoded.pool,
          from: (receipt.from ?? "").toLowerCase(),
          feeWallet,
        };
      }
    }
    return null;
  }
  return null;
}
