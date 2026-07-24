import "server-only";

import type { Candle, Trade } from "../types";
import { densify } from "../market";
import {
  V3_SWAP_TOPIC0,
  decodeV3Swap,
  isTokenZero,
  type RawLog,
} from "./pons-pool";
import { PONS_PAIR_TOKEN } from "./pons";
import { getPonsPool } from "./pons-market";
import { HOOD_DEFAULT_RPC } from "./registry";

// Candles + recent trades for a PONS token, built from its Uniswap V3 pool's
// Swap logs — the EVM counterpart of lib/market.ts's GeckoTerminal path. There
// is no third-party OHLCV feed for Robinhood Chain, so the history IS the raw
// swap stream: read the pool's `Swap` events, price each one (ethOut/tokenOut),
// and bucket them into OHLCV ourselves. The pure bucketing/mapping is unit
// tested; the I/O layer mirrors the proven hood-buybot getLogs reader.
//
// Best-effort throughout, same posture as the Solana side: any failure returns
// [] and the caller shows an honest empty state.

const RPC = process.env.HOOD_RPC_URL || HOOD_DEFAULT_RPC;

// Robinhood Chain runs ~0.1s blocks, so a timeframe's block span is large but a
// SINGLE pool's swap count stays well under the RPC's 10k-result getLogs cap.
// Bucket sizes match the Solana chart's grains so both chains read identically.
const TF: Record<string, { bucketSec: number; limit: number }> = {
  "1H": { bucketSec: 15 * 60, limit: 60 },
  "4H": { bucketSec: 60 * 60, limit: 60 },
  "1D": { bucketSec: 4 * 60 * 60, limit: 60 },
  ALL: { bucketSec: 24 * 60 * 60, limit: 365 },
};

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return ((await res.json())?.result ?? null) as T | null;
  } catch {
    return null;
  }
}

/** A swap with everything a candle/trade needs, chain-agnostic from here on. */
export interface PricedSwap {
  tsSec: number;
  /** Token price in USD at this swap (ethOut/tokenOut × ETH/USD). */
  priceUsd: number;
  /** ETH that moved, in USD — the bucket's volume contribution. */
  volumeUsd: number;
  /** Native (ETH) amount that moved, for the trades list. */
  eth: number;
  /** Token amount that moved, whole tokens. */
  tokens: number;
  isBuy: boolean;
  trader: string | null;
  txHash: string | null;
}

/**
 * Price a decoded swap. Both legs are 18-decimal (Pons ERC-20 + WETH), so the
 * per-token ETH price is simply ethWei/tokenWei — the 1e18 scales cancel. A swap
 * that moved no tokens (shouldn't happen) is dropped by returning null.
 */
export function priceSwap(
  s: { ethWei: bigint; tokenWei: bigint; isBuy: boolean; trader: string | null; txHash: string | null },
  tsSec: number,
  ethUsd: number
): PricedSwap | null {
  if (s.tokenWei <= BigInt(0)) return null;
  const eth = Number(s.ethWei) / 1e18;
  const tokens = Number(s.tokenWei) / 1e18;
  const priceEth = eth / tokens;
  if (!Number.isFinite(priceEth) || priceEth <= 0) return null;
  return {
    tsSec,
    priceUsd: priceEth * ethUsd,
    volumeUsd: eth * ethUsd,
    eth,
    tokens,
    isBuy: s.isBuy,
    trader: s.trader,
    txHash: s.txHash,
  };
}

/**
 * Bucket chronological swaps into OHLCV candles at `bucketSec`, gap-filled to
 * the current bucket by the same densify the Solana path uses (so a quiet
 * stretch reads as a flat line, not a missing one). `nowSec` is injected for
 * deterministic tests.
 */
export function swapsToCandles(
  swaps: PricedSwap[],
  bucketSec: number,
  limit: number,
): Candle[] {
  if (!swaps.length || bucketSec <= 0) return [];
  // Group by bucket, preserving order (swaps arrive oldest→newest).
  const rows: number[][] = [];
  let cur: { t: number; o: number; h: number; l: number; c: number; v: number } | null = null;
  for (const s of swaps) {
    const t = Math.floor(s.tsSec / bucketSec) * bucketSec;
    if (!cur || t !== cur.t) {
      if (cur) rows.push([cur.t, cur.o, cur.h, cur.l, cur.c, cur.v]);
      cur = { t, o: s.priceUsd, h: s.priceUsd, l: s.priceUsd, c: s.priceUsd, v: s.volumeUsd };
    } else {
      cur.h = Math.max(cur.h, s.priceUsd);
      cur.l = Math.min(cur.l, s.priceUsd);
      cur.c = s.priceUsd;
      cur.v += s.volumeUsd;
    }
  }
  if (cur) rows.push([cur.t, cur.o, cur.h, cur.l, cur.c, cur.v]);
  return densify(rows, bucketSec, limit);
}

/** Map swaps (newest-first) to the shared Trade shape. `nowSec` is injected. */
export function swapsToTrades(swaps: PricedSwap[], nowSec: number, n = 10): Trade[] {
  return swaps
    .slice()
    .reverse()
    .slice(0, n)
    .map((s) => ({
      addr: shortAddr(s.trader ?? ""),
      fullAddr: s.trader ?? undefined,
      side: s.isBuy ? "BUY" : "SELL",
      sol: fmtEth(s.eth),
      tokens: Math.round(s.tokens).toLocaleString("en-US"),
      ageSeconds: Math.max(0, Math.round(nowSec - s.tsSec)),
      sig: s.txHash ?? undefined,
      priceUsd: s.priceUsd || undefined,
    }));
}

/** Block-number → unix-seconds via linear interpolation between two on-chain
 *  anchors. Robinhood Chain's block time is regular enough (~0.1s) that this is
 *  accurate to well within a candle bucket, at a fixed cost of two RPC reads —
 *  fetching every swap's block individually would be hundreds of calls. */
export function interpolateTs(
  block: number,
  a: { block: number; ts: number },
  b: { block: number; ts: number },
): number {
  if (a.block === b.block) return a.ts;
  const slope = (b.ts - a.ts) / (b.block - a.block);
  return Math.round(a.ts + (block - a.block) * slope);
}

interface AnchorBlock {
  block: number;
  ts: number;
}

async function blockAnchor(blockHex: string): Promise<AnchorBlock | null> {
  const b = await rpc<{ number?: string; timestamp?: string }>("eth_getBlockByNumber", [blockHex, false]);
  if (!b?.number || !b?.timestamp) return null;
  try {
    return { block: Number(BigInt(b.number)), ts: Number(BigInt(b.timestamp)) };
  } catch {
    return null;
  }
}

interface RpcSwapLog extends RawLog {
  blockNumber?: string | null;
}

/**
 * Read + price a Pons pool's swaps over the most recent `spanBlocks`, oldest→
 * newest. Returns [] on any failure (no pool yet, RPC down, decode miss).
 */
async function readSwaps(token: string, ethUsd: number, spanBlocks: number): Promise<PricedSwap[]> {
  const pool = await getPonsPool(token);
  if (!pool || ethUsd <= 0) return [];

  const latestHex = await rpc<string>("eth_blockNumber", []);
  if (!latestHex) return [];
  const latest = Number(BigInt(latestHex));
  const from = Math.max(0, latest - spanBlocks);
  const fromHex = "0x" + from.toString(16);

  const logs = await rpc<RpcSwapLog[]>("eth_getLogs", [
    { address: pool, topics: [V3_SWAP_TOPIC0], fromBlock: fromHex, toBlock: "latest" },
  ]);
  if (!logs?.length) return [];

  const isToken0 = isTokenZero(token, PONS_PAIR_TOKEN);
  const decoded = logs
    .map((log) => {
      const s = decodeV3Swap(log, { isToken0 });
      const block = log.blockNumber ? Number(BigInt(log.blockNumber)) : null;
      return s && block != null ? { s, block } : null;
    })
    .filter((x): x is { s: NonNullable<ReturnType<typeof decodeV3Swap>>; block: number } => x != null)
    .sort((a, b) => a.block - b.block);
  if (!decoded.length) return [];

  // Two anchors (earliest + latest swap block) map every block to a timestamp.
  const lo = decoded[0].block;
  const hi = decoded[decoded.length - 1].block;
  const [aLo, aHi] = await Promise.all([
    blockAnchor("0x" + lo.toString(16)),
    lo === hi ? Promise.resolve(null) : blockAnchor("0x" + hi.toString(16)),
  ]);
  if (!aLo) return [];
  const anchorHi = aHi ?? aLo;

  const out: PricedSwap[] = [];
  for (const { s, block } of decoded) {
    const ts = interpolateTs(block, aLo, anchorHi);
    const priced = priceSwap(
      { ethWei: s.ethWei, tokenWei: s.tokenWei, isBuy: s.isBuy, trader: s.recipient, txHash: s.txHash },
      ts,
      ethUsd,
    );
    if (priced) out.push(priced);
  }
  return out;
}

/** Candles + recent trades for a Pons token at timeframe `tf`. One getLogs read
 *  shared between them, so the token page's Hood branch costs the same as one
 *  market refresh. */
export async function getPonsHistory(
  token: string,
  ethUsd: number,
  tf: string,
): Promise<{ candles: Candle[]; trades: Trade[] }> {
  const grain = TF[tf] ?? TF["1D"];
  // Enough blocks to cover the visible window; ~0.1s blocks ⇒ 10 blocks/sec.
  const spanBlocks = Math.ceil((grain.bucketSec * grain.limit) / 0.1);
  const swaps = await readSwaps(token, ethUsd, spanBlocks);
  if (!swaps.length) return { candles: [], trades: [] };
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    candles: swapsToCandles(swaps, grain.bucketSec, grain.limit),
    trades: swapsToTrades(swaps, nowSec, 10),
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function shortAddr(a: string): string {
  return a.length > 9 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** ETH amounts are small; show enough significant figures without a wall of zeros. */
function fmtEth(v: number): string {
  if (v === 0) return "0";
  if (v >= 0.1) return v.toFixed(3);
  if (v >= 0.0001) return v.toFixed(5);
  return v.toExponential(2);
}
