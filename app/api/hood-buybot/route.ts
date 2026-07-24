import { NextResponse } from "next/server";
import { HOOD_DEFAULT_RPC } from "@/lib/chains/registry";
import { hoodLauncherAddress } from "@/lib/chains/hood-abi";
import {
  TRADE_TOPIC0,
  addressTopic,
  decodeTradeLog,
  formatBuyAlert,
  type RpcLog,
} from "@/lib/hood-buybot";
import { decodeV3Swap, isTokenZero, V3_SWAP_TOPIC0 } from "@/lib/chains/pons-pool";
import { getPonsPool } from "@/lib/chains/pons-market";
import { PONS_PAIR_TOKEN } from "@/lib/chains/pons";
import { sendTelegramMessage } from "@/lib/telegram-send";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hood LOOP buy-alert bot. A cron hits this; it reads recent trades for the
 * LOOP-Hood token, keeps the buys, dedupes them by tx hash (Supabase
 * `hood_buys`), and posts each new one to the Telegram group. Custom because
 * chain 4663 is too new for a hosted buybot.
 *
 * TWO SOURCES, because a Pons token has no bonding curve: it trades in a
 * Uniswap V3 pool from block one and never emits our launcher's `Trade` event.
 * Reading only the launcher would leave the bot permanently silent on a live
 * market. So: if the token has a Pons pool, read that pool's `Swap` logs;
 * otherwise fall back to the HoodLauncher as before.
 *
 * No-ops cleanly until the token + a source + Telegram + the dedupe table are
 * all configured.
 *
 * Env: NEXT_PUBLIC_HOOD_LOOP_MINT, NEXT_PUBLIC_HOOD_LAUNCHER_ADDRESS (only for
 * the launcher fallback), TELEGRAM_BOT_TOKEN, TELEGRAM_GROUP_CHAT_ID,
 * TELEGRAM_BUYS_THREAD_ID (opt), HOOD_ETH_USD (opt, to show $), and
 * CRON_SECRET/COMPUTE_INGEST_SECRET to auth.
 */

const RPC = process.env.HOOD_RPC_URL || HOOD_DEFAULT_RPC;
// Robinhood Chain runs ~0.1s blocks (10/s), so the window must be sized in those
// terms, not a chain-agnostic guess: 1200 blocks was only ~2 minutes, but the
// GitHub-Actions cron that drives this is throttled on a public repo to an
// effective ~5–30 min (occasionally more). At 2 min of lookback the bot silently
// missed every buy older than that between fires — the tx-hash dedupe stops
// double-posts but can't recover buys that fell outside the window. 30k blocks =
// ~50 min covers the worst throttle plus a skipped fire; re-scanning the overlap
// is free (idempotent), and the getLogs is filtered to the one pool so its result
// count stays far under the RPC's 10k cap. The Supabase pg_cron primary (tighter
// cadence) is the real-time path; this stays the backstop.
const LOOKBACK_BLOCKS = 30_000;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim() || process.env.COMPUTE_INGEST_SECRET?.trim() || "";
  if (!secret) return false;
  const header =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.headers.get("x-compute-secret") ||
    "";
  return header === secret;
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
    return ((await res.json())?.result ?? null) as T | null;
  } catch {
    return null;
  }
}

// A single getLogs is capped at 10k results by the RPC, and a busy pool can
// exceed that inside the (deliberately large) lookback window — which would make
// the whole read fail exactly during a launch pump. Split the range into fixed
// sub-windows well under the cap and merge; the tx-hash dedupe makes the extra
// calls free of double-posts. ~5k blocks ≈ 8 minutes at Robinhood's 0.1s blocks,
// far below 10k swaps for any realistic pool. Returns null only if EVERY chunk
// failed (genuine RPC outage); a partial failure still returns what it read, and
// the next cron re-scans the gap.
const CHUNK_BLOCKS = 5_000;

async function getLogsChunked(
  address: string,
  topics: (string | null)[],
  from: number,
  to: number,
): Promise<RpcLog[] | null> {
  const out: RpcLog[] = [];
  let anyOk = false;
  for (let start = from; start <= to; start += CHUNK_BLOCKS + 1) {
    const end = Math.min(start + CHUNK_BLOCKS, to);
    const chunk = await rpc<RpcLog[]>("eth_getLogs", [
      { address, topics, fromBlock: "0x" + start.toString(16), toBlock: "0x" + end.toString(16) },
    ]);
    if (chunk === null) continue; // transient — the next cron re-scans this gap
    anyOk = true;
    out.push(...chunk);
  }
  return anyOk ? out : null;
}

/** Insert a tx hash; returns true only if it's newly seen (dedupe). */
async function claimBuy(txHash: string): Promise<boolean> {
  if (!supabaseAdmin) return false; // no store → don't post (avoids spam on re-reads)
  const { error } = await supabaseAdmin.from("hood_buys").insert({ tx_hash: txHash });
  if (!error) return true;
  // Unique-violation → already posted; missing table → treat as "can't dedupe".
  if (/duplicate key|unique/i.test(error.message)) return false;
  return false;
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const token = (process.env.NEXT_PUBLIC_HOOD_LOOP_MINT || "").trim();
  const launcher = hoodLauncherAddress();
  const chatId = (process.env.TELEGRAM_GROUP_CHAT_ID || "").trim();
  const threadId = Number(process.env.TELEGRAM_BUYS_THREAD_ID) || undefined;
  const ethUsd = Number(process.env.HOOD_ETH_USD) || null;
  if (!token || !chatId) {
    return NextResponse.json({ ok: true, skipped: "hood buybot not configured", posted: 0 });
  }

  // Prefer the Pons pool; it's how a Pons-launched token actually trades.
  const pool = await getPonsPool(token);
  if (!pool && !launcher) {
    return NextResponse.json({ ok: true, skipped: "no pons pool and no launcher", posted: 0 });
  }

  const latestHex = await rpc<string>("eth_blockNumber", []);
  if (!latestHex) return NextResponse.json({ error: "rpc unreachable" }, { status: 502 });
  const latest = Number(BigInt(latestHex));
  const from = Math.max(0, latest - LOOKBACK_BLOCKS);

  // The topic filter for whichever source this token uses.
  const topics = pool ? [V3_SWAP_TOPIC0] : [TRADE_TOPIC0, addressTopic(token)];
  const address = pool ?? launcher!;
  const logs = await getLogsChunked(address, topics, from, latest);
  if (logs === null) return NextResponse.json({ error: "getLogs failed" }, { status: 502 });

  // Pool amounts are signed from the POOL's side, so which token is token0
  // decides what counts as a buy. Getting it backwards announces every sell.
  const isToken0 = isTokenZero(token, PONS_PAIR_TOKEN);

  let posted = 0;
  for (const log of logs) {
    const trade = pool
      ? (() => {
          const s = decodeV3Swap(log, { isToken0 });
          return s && { ...s, trader: s.recipient ?? "" };
        })()
      : decodeTradeLog(log);
    if (!trade || !trade.isBuy || !trade.txHash) continue;
    if (!(await claimBuy(trade.txHash))) continue; // already posted / can't dedupe
    const msg = formatBuyAlert({
      tokenSymbol: "$LOOP",
      ethWei: trade.ethWei,
      tokenWei: trade.tokenWei,
      trader: trade.trader,
      txHash: trade.txHash,
      ethUsd,
    });
    const r = await sendTelegramMessage(chatId, msg, threadId, "HTML");
    if (r.ok) posted++;
  }

  return NextResponse.json({ ok: true, source: pool ? "pons-pool" : "launcher", scanned: logs.length, posted });
}

export const GET = handle; // Vercel cron issues GET
export const POST = handle;
