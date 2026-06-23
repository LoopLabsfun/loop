import { sanitizeDirectiveText } from "./directives";

// Pure helpers for the $LOOP-metered agent chat (operator-style "ask the agent",
// where each message sends $LOOP to the project treasury and a boost jumps the
// queue). JSX-free + dependency-light so pricing + base-unit math are unit-tested;
// the React surface lives in components/token/AgentChat.tsx, the persistence in
// lib/actions.ts + lib/agent-data.ts.

export const CHAT_TEXT_MAX = 600;

/** pump.fun SPL tokens (incl. $LOOP) mint with 6 decimals. */
export const TOKEN_DECIMALS = 6;

/** Trim/collapse/cap a chat question (reuses the directive sanitizer). */
export const sanitizeChatText = sanitizeDirectiveText;

/**
 * Base price, in whole $LOOP, to send the agent one message. Overridable via
 * NEXT_PUBLIC_CHAT_LOOP_PRICE (public — it's shown in the UI); defaults to 1000.
 */
export function chatBasePrice(): number {
  const n = Number(process.env.NEXT_PUBLIC_CHAT_LOOP_PRICE);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

/**
 * Pure: the total $LOOP a message costs = base + boost. The boost is the extra
 * the sender adds to be answered first; it's clamped to ≥ 0 and NaN-safe.
 */
export function chatCost(boost: number, base: number = chatBasePrice()): number {
  const b = Number.isFinite(boost) && boost > 0 ? boost : 0;
  return base + b;
}

/**
 * Pure, BigInt-safe: a UI token amount → integer base units for an SPL transfer
 * (avoids float drift by scaling decimal strings, not multiplying floats).
 * Non-positive / non-finite inputs → 0n.
 */
export function toBaseUnits(uiAmount: number, decimals: number): bigint {
  if (!Number.isFinite(uiAmount) || uiAmount <= 0) return BigInt(0);
  // toFixed avoids scientific notation for the magnitudes we deal with.
  const fixed = uiAmount.toFixed(decimals);
  const [intPart, fracPart = ""] = fixed.split(".");
  const frac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(intPart + frac);
}

/** A token-balance entry from a parsed transaction's pre/postTokenBalances. */
export interface TokenBalanceEntry {
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string };
}

/**
 * Pure: net base units of `mint` credited to `owner` across a transaction —
 * (sum of post balances) − (sum of pre balances) for accounts owned by `owner`
 * holding `mint`. Used to verify a chat payment really moved $LOOP to the
 * treasury (the destination ATA may be new, so it's absent from `pre` → counts
 * as 0). BigInt-safe; malformed amounts are skipped.
 */
export function creditedBaseUnits(
  pre: TokenBalanceEntry[] | undefined,
  post: TokenBalanceEntry[] | undefined,
  mint: string,
  owner: string
): bigint {
  const sum = (bals?: TokenBalanceEntry[]): bigint => {
    let s = BigInt(0);
    for (const b of bals ?? []) {
      if (b?.mint === mint && b?.owner === owner) {
        try {
          s += BigInt(b.uiTokenAmount?.amount ?? "0");
        } catch {
          /* non-integer amount — skip */
        }
      }
    }
    return s;
  };
  return sum(post) - sum(pre);
}

/** A `public.agent_chat` row (snake_case columns). */
export interface ChatRow {
  id: number;
  wallet: string;
  question: string;
  answer: string | null;
  loop_paid: number | null;
  boost: number | null;
  tx_sig: string | null;
  status: string;
  created_at: string;
}

/** The chat message the UI renders. */
export interface ChatMsg {
  id: string;
  wallet: string;
  question: string;
  /** The agent's reply, or null while queued. */
  answer: string | null;
  loopPaid: number;
  boost: number;
  txSig: string | null;
  status: "open" | "answered";
  at: string;
  /** Epoch ms for chronological merge with the steering feed (0 when unknown). */
  ts?: number;
}

/**
 * Pure: a compact "recent ships" block from the project's latest commits, for the
 * agent's chat-answer system prompt — so "what are you working on?" answers from
 * real recent work instead of just the mission. Takes the first line of each
 * message, caps the list, and returns "" when there's nothing (caller omits the
 * block). Kept dependency-light so it's unit-tested alongside the pricing helpers.
 */
export function buildChatContext(
  commits: { msg?: string }[] | null | undefined,
  max = 4
): string {
  const lines: string[] = [];
  for (const c of commits ?? []) {
    const first = (c?.msg ?? "").split("\n")[0].trim();
    if (first) lines.push(`- ${first.slice(0, 120)}`);
    if (lines.length >= max) break;
  }
  return lines.join("\n");
}

/**
 * Pure: map a persisted chat row to the UI message. `at` is supplied by the
 * caller (server) so this stays time-source-agnostic.
 */
export function rowToChatMsg(r: ChatRow, at: string): ChatMsg {
  return {
    id: `q${r.id}`,
    wallet: r.wallet,
    question: r.question,
    answer: r.answer ?? null,
    loopPaid: r.loop_paid ?? 0,
    boost: r.boost ?? 0,
    txSig: r.tx_sig ?? null,
    status: r.status === "answered" ? "answered" : "open",
    at,
    ts: r.created_at ? Date.parse(r.created_at) || 0 : 0,
  };
}
