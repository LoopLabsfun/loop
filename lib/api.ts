// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION SEAM
//
// The live "feel" of the app — treasury ticks, candles, trades, agent log —
// is generated here. Each function is the single place to swap a real source
// (Solana RPC, a price feed, a realtime subscription) without touching the UI.
// Persistent project data lives in lib/queries.ts (Supabase).
// ─────────────────────────────────────────────────────────────────────────────

import { PROJECTS } from "./projects";
import type {
  Candle,
  Commit,
  Launchpad,
  ProjectKey,
  RewardClaim,
  Trade,
  Treasury,
} from "./types";
import { SOL_USD } from "./format";

// NOTE: project reads/writes now live in `lib/queries.ts` (Supabase-backed)
// and `lib/actions.ts` (launch server action). This file keeps the simulation
// helpers — live treasury ticks, candles, trades — that stay client-side.

// --- Treasury ---------------------------------------------------------------
// Real: Solana RPC `getBalance(walletPubkey)` + an indexer for income/spend.
export function getTreasury(key: ProjectKey = "loop"): Treasury {
  const p = PROJECTS[key];
  return {
    wallet: "7xK…g4fR",
    balanceSol: p.treasurySol,
    totalEarnedSol: p.earnedSol,
    income24hSol: 1.32,
    spend24hSol: 0.64,
    burnPerDay: p.burnPerDay,
    nextCheckSeconds: 165,
  };
}

// --- Reward claims ----------------------------------------------------------
// Real: Pump.fun / Bags.fun creator-reward claim history per wallet.
export function getRecentClaims(): RewardClaim[] {
  return [
    { when: "2 min ago", amount: "0.12", source: "Pump.fun" },
    { when: "17 min ago", amount: "0.18", source: "Pump.fun" },
    { when: "32 min ago", amount: "0.15", source: "Bags.fun" },
    { when: "47 min ago", amount: "0.21", source: "Pump.fun" },
  ];
}

// --- Commits ----------------------------------------------------------------
// Real: GitHub API `GET /repos/{owner}/{repo}/commits`.
export function getRecentCommits(): Commit[] {
  return [
    { message: "feat: add project dashboard", when: "3 min ago" },
    { message: "fix: treasury balance sync", when: "14 min ago" },
    { message: "feat: auto-claim system", when: "1 h ago" },
    { message: "chore: optimize agent loop", when: "2 h ago" },
  ];
}

// --- Agent log --------------------------------------------------------------
// Real: stream from the agent runner (Supabase Realtime / WebSocket).
export function getInitialAgentLog() {
  return [
    { t: "[12:44:58]", msg: "claiming rewards from pump.fun … +0.12 SOL" },
    { t: "[12:45:01]", msg: "deposited to treasury ✓" },
    { t: "[12:45:02]", msg: "budget remaining: 7.24 SOL" },
    { t: "[12:45:04]", msg: "starting coding cycle …" },
    { t: "[12:45:09]", msg: "commit 8f3a21c pushed → github.com/loop-fun/loop" },
  ];
}

// Pool the simulation pulls from to fake live agent output.
export const AGENT_LOG_POOL = [
  "analyzing open issues …",
  "task: implement project page filters",
  "generating code … 412 tokens/s",
  "running tests ✓ 38 passed",
  "deploying preview build ✓",
  "claiming rewards from bags.fun … +0.08 SOL",
];

// --- Market data (token page) ----------------------------------------------
// Real: a price/candle feed (Birdeye, Jupiter, GeckoTerminal) for the mint.
export function genCandles(
  tf: "1H" | "4H" | "1D",
  base: number
): Candle[] {
  const v = { "1H": 0.006, "4H": 0.012, "1D": 0.022 }[tf];
  let p = base * (1 - v * 14);
  const out: Candle[] = [];
  for (let i = 0; i < 48; i++) {
    const o = p;
    const c = Math.max(base * 0.2, p * (1 + v * (Math.random() - 0.44) * 2));
    const h = Math.max(o, c) * (1 + Math.random() * v);
    const l = Math.min(o, c) * (1 - Math.random() * v);
    out.push({ o, h, l, c });
    p = c;
  }
  return out;
}

const TRADE_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz123456789";

export function mkTrade(price: number, age: number): Trade {
  const buy = Math.random() > 0.4;
  const s = 0.05 + Math.random() * 2.4;
  const r = (k: number) =>
    Array.from(
      { length: k },
      () => TRADE_CHARS[Math.floor(Math.random() * TRADE_CHARS.length)]
    ).join("");
  return {
    addr: r(4) + "…" + r(4),
    side: buy ? "BUY" : "SELL",
    sol: s.toFixed(2),
    tokens: Math.round((s * SOL_USD) / price).toLocaleString("en-US"),
    ageSeconds: age,
  };
}

export function genTrades(price: number, n: number): Trade[] {
  const out: Trade[] = [];
  let age = 2 + Math.floor(Math.random() * 8);
  for (let i = 0; i < n; i++) {
    out.push(mkTrade(price, age));
    age += 4 + Math.floor(Math.random() * 30);
  }
  return out;
}

// --- Project launch ---------------------------------------------------------
// The launch itself runs as a server action in `lib/actions.ts`. These shared
// types describe its input/output.
export interface LaunchInput {
  name: string;
  ticker: string;
  prompt: string;
  repo?: string;
}

export interface LaunchResult {
  /** Project key (slug) — used to link to the new project's page. */
  key: string;
  ticker: string;
  staked: string;
  /** Launchpad the token was created on. */
  launchpad?: Launchpad;
  /** SPL mint address for a real launch; null/undefined in simulated mode. */
  mint?: string | null;
}
