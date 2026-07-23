import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// PONS FEE COLLECTION — the Hood half of the self-funding loop.
//
// A Pons launch mints its whole supply into a Uniswap V3 position owned by the
// PonsLaunchLocker, permanently. That position accrues swap fees forever.
// `collectFees(token)` on the locker pulls them and splits BOTH sides:
// `protocolFeeShare`% to Pons, the remainder to the launch's fee recipient —
// which is our treasury, because we pass it as `feeWallet` at launch time
// (see PonsTokenParams.feeWallet). Verified on-chain: protocolFeeShare = 30,
// so the treasury keeps 70% of both WETH and $LOOP.
//
// Callable by the deployer, the fee recipient, the locker owner, or an
// allow-listed collector — our treasury is the deployer AND the recipient, so
// it can always collect. This module only ENCODES and READS; the signing lives
// with the caller (the founder's wallet in the UI, or the agent wallet later).
// ─────────────────────────────────────────────────────────────────────────────

import { PONS_LOCKER, PONS_SELECTORS, PONS_PAIR_TOKEN } from "./pons";
import { HOOD_DEFAULT_RPC } from "./registry";

const RPC = process.env.HOOD_RPC_URL || HOOD_DEFAULT_RPC;

function padAddress(addr: string): string {
  return addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) return null;
    return (((await res.json()) as { result?: T }).result ?? null) as T | null;
  } catch {
    return null;
  }
}

/** Calldata for `collectFees(token)` on the Pons locker. The caller signs and
 *  sends this TO {@link PONS_LOCKER} with zero value. */
export function encodeCollectFees(token: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(token)) {
    throw new Error("encodeCollectFees: token must be a 20-byte address");
  }
  return "0x" + PONS_SELECTORS.collectFees + padAddress(token);
}

/** The protocol's cut in percent (0-100). The treasury keeps `100 - this`. */
export async function readProtocolFeeShare(): Promise<number | null> {
  const hex = await rpc<string>("eth_call", [
    { to: PONS_LOCKER, data: "0x" + PONS_SELECTORS.protocolFeeShare },
    "latest",
  ]);
  if (!hex || hex === "0x") return null;
  const n = Number(BigInt(hex));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

/** Who currently receives the creator share for `token` (zero address ⇒ the
 *  locker falls back to the launch deployer). Lets the UI prove, before anyone
 *  clicks, that fees really are routed to the treasury. */
export async function readFeeRecipient(token: string): Promise<string | null> {
  const hex = await rpc<string>("eth_call", [
    { to: PONS_LOCKER, data: "0x" + PONS_SELECTORS.feeRedirects + padAddress(token) },
    "latest",
  ]);
  if (!hex || hex.length < 66) return null;
  return "0x" + hex.slice(-40);
}

/** keccak("FeesClaimed(address,address,address,address,uint256,uint256,uint256,uint256)")
 *  — emitted by the locker on every successful collect. `token` and `caller`
 *  are indexed (topics 1-2); the four amounts are in the data block. */
export const FEES_CLAIMED_TOPIC0 =
  "0x1547f2bd1a244399782ebde22047e2ede698ecdc4d6c7d4b3c4e2435f1e47f7a";

export interface ClaimedFees {
  token: string;
  /** WETH that actually landed on the fee recipient (our treasury), in wei. */
  recipientWethWei: bigint;
  /** Launch-token side that landed on the recipient, in base units. */
  recipientTokenUnits: bigint;
}

/**
 * Decode a FeesClaimed log into the amounts the RECIPIENT actually received.
 * Pure: the caller supplies the log, so this is unit-testable without a chain.
 * Returns null for any other log, so it can be run over a whole receipt.
 */
export function decodeFeesClaimed(log: {
  address: string;
  topics: string[];
  data: string;
}): ClaimedFees | null {
  if ((log.topics?.[0] ?? "").toLowerCase() !== FEES_CLAIMED_TOPIC0) return null;
  if (log.address.toLowerCase() !== PONS_LOCKER.toLowerCase()) return null;
  const token = "0x" + (log.topics[1] ?? "").slice(-40);
  const body = (log.data || "").replace(/^0x/, "");
  if (body.length < 6 * 64) return null;
  const word = (i: number) => BigInt("0x" + body.slice(i * 64, (i + 1) * 64));
  const token0 = "0x" + body.slice(24, 64);
  const recipientAmount0 = word(2);
  const recipientAmount1 = word(3);
  // Which side is WETH depends on the pool's address sort order.
  const zeroIsWeth = token0.toLowerCase() === PONS_PAIR_TOKEN.toLowerCase();
  return {
    token,
    recipientWethWei: zeroIsWeth ? recipientAmount0 : recipientAmount1,
    recipientTokenUnits: zeroIsWeth ? recipientAmount1 : recipientAmount0,
  };
}

/**
 * Verify a collect the founder already signed, and extract what the treasury
 * actually received — the trust boundary for ledger writes. Everything is
 * re-derived from the chain: the tx must have succeeded, been sent TO the
 * locker, and carry a FeesClaimed log from the locker itself. Returns null
 * otherwise, so a caller never records fees that didn't happen.
 */
export async function verifyCollectTx(txHash: string): Promise<ClaimedFees | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const receipt = await rpc<{
      status?: string;
      to?: string | null;
      logs?: { address: string; data: string; topics: string[] }[];
    }>("eth_getTransactionReceipt", [txHash]);
    if (!receipt) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (receipt.status !== "0x1") return null;
    if ((receipt.to ?? "").toLowerCase() !== PONS_LOCKER.toLowerCase()) return null;
    for (const log of receipt.logs ?? []) {
      const decoded = decodeFeesClaimed(log);
      if (decoded) return decoded;
    }
    return null;
  }
  return null;
}

export interface CollectableFees {
  /** Uncollected WETH owed to the position, in wei (both shares, pre-split). */
  wethWei: bigint;
  /** Uncollected $LOOP owed to the position, in base units (pre-split). */
  tokenUnits: bigint;
  /** The treasury's share after the protocol cut, in wei. */
  treasuryWethWei: bigint;
  protocolPct: number;
}

/**
 * How much is sitting uncollected right now, and what the treasury would get.
 *
 * `collectFees` is non-view (it moves funds), so the honest way to preview it
 * is to eth_call it FROM the treasury: the node simulates the whole thing
 * against current state and returns the (amount0, amount1) it would collect,
 * without ever broadcasting. A revert (typically NoFeesToCollect) means
 * nothing has accrued — reported as zeroes, not as an error.
 */
export async function readCollectableFees(
  token: string,
  from: string
): Promise<CollectableFees | null> {
  const protocolPct = (await readProtocolFeeShare()) ?? 30;
  const hex = await rpc<string>("eth_call", [
    { to: PONS_LOCKER, from, data: encodeCollectFees(token) },
    "latest",
  ]);
  // Reverted (nothing accrued yet) or unreadable ⇒ zero, not a failure.
  if (!hex || hex === "0x" || hex.length < 130) {
    return { wethWei: BigInt(0), tokenUnits: BigInt(0), treasuryWethWei: BigInt(0), protocolPct };
  }
  const amount0 = BigInt("0x" + hex.slice(2, 66));
  const amount1 = BigInt("0x" + hex.slice(66, 130));
  // The pool pairs the launch token against WETH; which one is amount0 depends
  // on address sort order, so decide from the addresses rather than assuming.
  const tokenIsZero = token.toLowerCase() < PONS_PAIR_TOKEN.toLowerCase();
  const wethWei = tokenIsZero ? amount1 : amount0;
  const tokenUnits = tokenIsZero ? amount0 : amount1;
  const treasuryWethWei = (wethWei * BigInt(100 - protocolPct)) / BigInt(100);
  return { wethWei, tokenUnits, treasuryWethWei, protocolPct };
}
