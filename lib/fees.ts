// ─────────────────────────────────────────────────────────────────────────────
// FEE ECONOMICS — how a project's creator fees are split and distributed.
//
// Loop is "Polsia, but funded by fees". pump.fun's native creator-fee sharing
// (Jan 2026) lets the coin's creator route fees to up to 10 wallets with
// assignable percentages, claimable via the PumpPortal creator-fee API. Loop
// uses that to split every project's creator fees three ways:
//
//   • founder  — the dev's share, claimable from the Loop UI
//   • agent    — funds the project's own agent wallet (compute + on-chain
//                actions: buyback / burn / airdrop / bounty) so it self-funds
//   • platform — Loop's cut (fixed), keeps the platform sustainable
//
// Custody model (founder's choice): **Loop is the on-chain creator** and
// claims/routes the split. The percentages below are custody-agnostic — they
// describe the split, not who holds the keys. Pure module, no I/O, fully tested.
// ─────────────────────────────────────────────────────────────────────────────

export type WalletRole = "founder" | "agent" | "platform";

export interface FeeSplit {
  /** Dev share (claimable by the founder). */
  founderPct: number;
  /** Funds the project's agent wallet. */
  agentPct: number;
  /** Loop's cut. */
  platformPct: number;
}

/** Loop's platform cut is fixed; the founder↔agent balance is the lever. */
export const PLATFORM_PCT = 5;

/** Default: agent-favoured so each project has runway to act autonomously. */
export const DEFAULT_SPLIT: FeeSplit = {
  founderPct: 30,
  agentPct: 65,
  platformPct: PLATFORM_PCT,
};

/** Founder share bounds (platform is fixed at PLATFORM_PCT, so 0..95). */
export const MIN_FOUNDER_PCT = 0;
export const MAX_FOUNDER_PCT = 100 - PLATFORM_PCT;

/**
 * Build a split from the single founder lever: platform is fixed, the agent
 * gets the remainder. Clamps the founder share into range and rounds to an
 * integer so the three shares always sum to exactly 100.
 */
export function makeSplit(founderPct: number): FeeSplit {
  const founder = clampInt(founderPct, MIN_FOUNDER_PCT, MAX_FOUNDER_PCT);
  return {
    founderPct: founder,
    agentPct: 100 - PLATFORM_PCT - founder,
    platformPct: PLATFORM_PCT,
  };
}

/** A split is valid when shares are non-negative integers summing to 100. */
export function isValidSplit(s: FeeSplit): boolean {
  const vals = [s.founderPct, s.agentPct, s.platformPct];
  if (!vals.every((v) => Number.isInteger(v) && v >= 0 && v <= 100)) return false;
  return vals[0] + vals[1] + vals[2] === 100;
}

export interface FeeDistribution {
  founderSol: number;
  agentSol: number;
  platformSol: number;
}

/**
 * Split a claimed creator-fee amount (SOL) across the three roles. Falls back
 * to the default split if given an invalid one, so a bad config can never
 * mis-route funds silently. The three parts always re-sum to `amountSol`
 * (rounding remainder lands on the agent share — the operating account).
 */
export function distribute(amountSol: number, split: FeeSplit): FeeDistribution {
  const s = isValidSplit(split) ? split : DEFAULT_SPLIT;
  const amt = amountSol > 0 ? amountSol : 0;
  const founderSol = round9((amt * s.founderPct) / 100);
  const platformSol = round9((amt * s.platformPct) / 100);
  // Remainder to the agent so the parts re-sum exactly (no dust lost/created).
  const agentSol = round9(amt - founderSol - platformSol);
  return { founderSol, agentSol, platformSol };
}

/** Short human label, e.g. "30 / 65 / 5". */
export function splitLabel(s: FeeSplit): string {
  return `${s.founderPct} / ${s.agentPct} / ${s.platformPct}`;
}

/**
 * The split for a project from its stored founder lever (`feeFounderPct`).
 * Falls back to the default when unset, so existing/seed projects stay valid.
 */
export function splitForProject(p: { feeFounderPct?: number | null }): FeeSplit {
  return p.feeFounderPct == null ? DEFAULT_SPLIT : makeSplit(p.feeFounderPct);
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// Round to lamport precision (1 SOL = 1e9 lamports) to avoid float drift.
function round9(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}
