// Custom buy-alert bot for a Hood (Robinhood Chain) token — the launcher emits
//   event Trade(address indexed token, address indexed trader, bool isBuy,
//                uint256 ethAmount, uint256 tokenAmount)
// so we watch its logs and post the buys to Telegram. This is CUSTOM (not a
// hosted buybot) because chain 4663 is too new for @Pump_Fun_Buy_Bot /
// DexScreener to cover yet. Pure decode + format here (unit-tested); the RPC
// poll + Telegram send live in app/api/hood-buybot/route.ts. See
// docs/multichain-hood.md and docs/telegram-launch.md.

import { HOOD_EXPLORER } from "./chains/registry";

// keccak256("Trade(address,address,bool,uint256,uint256)") — via `cast keccak`.
export const TRADE_TOPIC0 = "0x8bec65d6ee5a26ecf71caf53f9585123357a7a9e9557638044890bfbe708abc3";

/** A 32-byte, 0x-prefixed topic for an EVM address (left-padded) — for eth_getLogs. */
export function addressTopic(address: string): string {
  const a = address.toLowerCase().replace(/^0x/, "");
  return "0x" + a.padStart(64, "0");
}

/** An address recovered from an indexed 32-byte topic (the low 20 bytes). */
export function addressFromTopic(topic: string): string {
  const t = topic.toLowerCase().replace(/^0x/, "");
  return "0x" + t.slice(-40);
}

export interface RpcLog {
  topics: string[];
  data: string; // 0x + 3 * 32-byte words: isBuy, ethAmount, tokenAmount
  transactionHash?: string;
  blockNumber?: string;
}

export interface TradeEvent {
  token: string;
  trader: string;
  isBuy: boolean;
  ethWei: bigint;
  tokenWei: bigint;
  txHash: string | null;
  blockNumber: number | null;
}

function word(data: string, i: number): string {
  const hex = data.replace(/^0x/, "");
  return hex.slice(i * 64, i * 64 + 64);
}

/**
 * Decode a Trade log. topics = [TRADE_TOPIC0, token, trader]; data packs
 * (bool isBuy, uint256 ethAmount, uint256 tokenAmount). Returns null on a
 * shape mismatch so a malformed log never throws in the poll loop.
 */
export function decodeTradeLog(log: RpcLog): TradeEvent | null {
  if (!log || !Array.isArray(log.topics) || log.topics.length < 3) return null;
  if (log.topics[0].toLowerCase() !== TRADE_TOPIC0) return null;
  const hex = (log.data || "").replace(/^0x/, "");
  if (hex.length < 192) return null;
  try {
    return {
      token: addressFromTopic(log.topics[1]),
      trader: addressFromTopic(log.topics[2]),
      isBuy: BigInt("0x" + word(log.data, 0)) !== BigInt(0),
      ethWei: BigInt("0x" + word(log.data, 1)),
      tokenWei: BigInt("0x" + word(log.data, 2)),
      txHash: log.transactionHash ?? null,
      blockNumber: log.blockNumber ? Number(BigInt(log.blockNumber)) : null,
    };
  } catch {
    return null;
  }
}

function pow10(n: number): bigint {
  let r = BigInt(1);
  for (let i = 0; i < n; i++) r *= BigInt(10);
  return r;
}

/** Format a base-unit bigint to a trimmed decimal string. */
export function fmtUnits(v: bigint, decimals: number, maxFrac = 4): string {
  const base = pow10(decimals);
  const whole = v / base;
  const frac = v % base;
  const wholeStr = whole.toLocaleString("en-US");
  if (frac === BigInt(0) || maxFrac === 0) return wholeStr;
  let f = frac.toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return f ? `${wholeStr}.${f}` : wholeStr;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// 🟢 intensity by ETH size — a bigger buy gets a longer bar (classic buybot feel).
function greenBar(ethValue: number): string {
  const n = ethValue >= 5 ? 12 : ethValue >= 1 ? 8 : ethValue >= 0.25 ? 5 : ethValue >= 0.05 ? 3 : 1;
  return "🟢".repeat(Math.min(n, 16));
}

export interface BuyAlertInput {
  tokenSymbol: string;
  ethWei: bigint;
  tokenWei: bigint;
  trader: string;
  txHash: string | null;
  tokenDecimals?: number; // launcher tokens are 18
  ethUsd?: number | null; // to show $ value of the ETH spent
  priceUsd?: number | null;
  mcapUsd?: string | null;
}

/**
 * A Telegram (HTML parse mode) buy alert. Values are numbers/known-safe so no
 * user text is interpolated — HTML-injection-safe by construction.
 */
export function formatBuyAlert(input: BuyAlertInput): string {
  const dec = input.tokenDecimals ?? 18;
  const ethUi = Number(input.ethWei) / 1e18;
  const sym = input.tokenSymbol.replace(/^\$/, "");
  const usd = input.ethUsd ? ` ($${(ethUi * input.ethUsd).toLocaleString("en-US", { maximumFractionDigits: 0 })})` : "";
  const lines = [
    `<b>🟢 $${sym} Buy!</b>`,
    greenBar(ethUi),
    `💵 <b>${fmtUnits(input.ethWei, 18, 4)} ETH</b>${usd}`,
    `🪙 ${fmtUnits(input.tokenWei, dec, 2)} ${sym}`,
    input.priceUsd ? `📈 Price $${input.priceUsd.toPrecision(3)}${input.mcapUsd ? ` · MC ${input.mcapUsd}` : ""}` : null,
    `👤 <code>${shortAddr(input.trader)}</code>`,
    input.txHash ? `🔗 <a href="${HOOD_EXPLORER}/tx/${input.txHash}">View on Blockscout</a>` : null,
  ].filter(Boolean);
  return lines.join("\n");
}
