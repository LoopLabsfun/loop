// Agent on-chain actions — the "agent manages its own token" layer (buyback,
// burn, airdrop, bounty, swap), the thing waifu/Sol does on Hyperliquid but
// scoped to a project's OWN token on Solana, under Loop's safety socle.
//
// Pure + dependency-free: the taxonomy, the multi-wallet roles, and the
// guardrail evaluation. Execution (Jupiter for spot/buyback/burn, a bounty
// escrow, etc.) is a later layer that signs from the Privy agent wallet — this
// module decides what is ALLOWED vs. what must ESCALATE before anything signs.
//
// "swap" is the treasury-portfolio lever (xStocks, see lib/xstocks.ts): the
// agent picks the target, the size, and the timing itself, on its own
// judgment — evaluateAction only enforces the SAME budget caps every other
// action already has (maxSolPerAction/maxDailySol) plus one security check
// specific to swap: outputMint must be a verified listed token (not "which
// stocks are good", just "is this actually the token it claims to be").

import { isXStockMint } from "./xstocks";

export type AgentActionKind =
  | "buyback" // buy the project's own token with treasury SOL
  | "burn" // permanently destroy tokens (irreversible)
  | "airdrop" // distribute tokens to holders/contributors (irreversible)
  | "bounty" // fund a task for real humans (pump.fun-style interaction)
  | "swap"; // rebalance treasury between assets

// Multi-wallet by risk tier (inspired by the waifu audit: cold treasury /
// hot operating / venue collateral are separated so a hot-wallet incident
// can't drain the treasury).
export type WalletRole = "cold_treasury" | "hot" | "venue_collateral";

export interface AgentAction {
  kind: AgentActionKind;
  /** SOL committed (buyback/bounty/swap-in). */
  amountSol?: number;
  /** Token units (burn/airdrop). */
  amountTokens?: number;
  /** Airdrop recipients (count only — addresses resolved at execution). */
  recipients?: number;
  /** swap only: the mint the agent wants treasury SOL routed into (its own
   *  portfolio pick — e.g. an xStock). Required for kind "swap"; validated
   *  against the verified xStocks registry, not against a financial-picks list. */
  outputMint?: string;
  note?: string;
}

/** Irreversible actions always require human sign-off, regardless of size. */
export function isIrreversible(kind: AgentActionKind): boolean {
  return kind === "burn" || kind === "airdrop";
}

export interface ActionPolicy {
  /** Hard cap on SOL any single action may commit. */
  maxSolPerAction: number;
  /** Rolling 24h SOL cap across all actions (the budget hard-stop's sibling). */
  maxDailySol: number;
  /** If false, irreversible actions are blocked outright (not just escalated). */
  allowIrreversible: boolean;
}

export const DEFAULT_POLICY: ActionPolicy = {
  maxSolPerAction: 0.5,
  maxDailySol: 2,
  allowIrreversible: true,
};

export type ActionVerdict =
  | { ok: true; escalate: boolean; reason: string }
  | { ok: false; escalate: boolean; reason: string };

/**
 * Decide whether the agent may perform an action now. `ok:false` = blocked;
 * `escalate:true` = needs founder→DAO approval before it can run (the escalation
 * ladder). The agent never executes an `escalate` action on its own authority.
 */
export function evaluateAction(
  a: AgentAction,
  policy: ActionPolicy = DEFAULT_POLICY,
  spentTodaySol = 0
): ActionVerdict {
  const sol = a.amountSol ?? 0;
  if (sol < 0) return { ok: false, escalate: false, reason: "Negative amount." };

  // A SOL-committing action (buyback/bounty/swap) of zero is a no-op: don't run
  // it. Without this the agent's stray 0-SOL buyback proposals reach the exec
  // layer and surface as a misleading "simulated 0 SOL" note. Irreversible kinds
  // (burn/airdrop) commit tokens, not SOL, so they fall through to their own gate.
  if (sol === 0 && !isIrreversible(a.kind)) {
    return { ok: false, escalate: false, reason: "Zero amount — nothing to commit." };
  }

  // swap = the treasury-portfolio lever. The agent's own judgment picks the
  // target; we only verify the mint is a real, listed xStock — never a
  // financial-quality opinion, purely "is this the token it claims to be".
  if (a.kind === "swap" && !isXStockMint(a.outputMint)) {
    return {
      ok: false,
      escalate: false,
      reason: a.outputMint
        ? `outputMint ${a.outputMint} is not a verified xStock — refusing to route funds to an unlisted token.`
        : "swap requires an outputMint (which xStock to buy).",
    };
  }

  if (sol > policy.maxSolPerAction) {
    return {
      ok: false,
      escalate: true,
      reason: `Exceeds per-action cap (${sol} > ${policy.maxSolPerAction} SOL).`,
    };
  }
  if (spentTodaySol + sol > policy.maxDailySol) {
    return {
      ok: false,
      escalate: true,
      reason: `Would exceed the 24h cap (${spentTodaySol + sol} > ${policy.maxDailySol} SOL).`,
    };
  }

  if (isIrreversible(a.kind)) {
    if (!policy.allowIrreversible) {
      return { ok: false, escalate: false, reason: `${a.kind} is disabled by policy.` };
    }
    // Within budget, but irreversible → human gate before signing.
    return {
      ok: false,
      escalate: true,
      reason: `${a.kind} is irreversible — requires founder/DAO approval.`,
    };
  }

  return { ok: true, escalate: false, reason: "Within mandate." };
}

/** Which wallet a given action should sign from. */
export function walletFor(kind: AgentActionKind): WalletRole {
  // Buyback/burn/airdrop/bounty operate from the hot operating wallet; only
  // explicit treasury rebalances touch cold storage.
  return kind === "swap" ? "cold_treasury" : "hot";
}
