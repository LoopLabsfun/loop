// Agent on-chain actions — the "agent manages its own token" layer (buyback,
// burn, airdrop, bounty, swap), the thing waifu/Sol does on Hyperliquid but
// scoped to a project's OWN token on Solana, under Loop's safety socle.
//
// Pure + dependency-free: the taxonomy, the multi-wallet roles, and the
// guardrail evaluation. Execution (Jupiter for spot/buyback/burn, a bounty
// escrow, etc.) is a later layer that signs from the Privy agent wallet — this
// module decides what is ALLOWED vs. what must ESCALATE before anything signs.

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
