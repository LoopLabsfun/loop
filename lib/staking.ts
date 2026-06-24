// Stake-to-participate (v1) — pure, client-safe economics + the canonical message
// a wallet signs to stake. Steering the agent (ask / propose) is gated on an
// active $LOOP stake instead of a per-message on-chain transfer: that transfer is
// what Phantom/Blowfish flagged as a scam on a new domain+token, and a signed
// message moves no funds, so it never trips the scanner.
//
// This is the EXPLICIT-stake layer (a recorded commitment), distinct from the
// passive holdings→boost tiers in lib/stake.ts. v1 does NOT take custody — your
// $LOOP stays in your wallet; the gate re-reads your live on-chain balance so a
// stake can't be gamed by staking then dumping. Locked-vault custody + the yield
// split (founder/agent/platform) are v2/v3.
//
// JSX-free + dependency-light (no tweetnacl here — the VERIFIER lives in
// signature.ts, mirroring buildDirectiveMessage/verifyDirectiveProof) so the
// thresholds and message format are unit-tested and safe to import client-side.

/**
 * Minimum staked $LOOP to unlock participation. Overridable via
 * NEXT_PUBLIC_STAKE_MIN_LOOP (public — it's shown in the UI); defaults to 10,000.
 */
export function stakeMin(): number {
  const n = Number(process.env.NEXT_PUBLIC_STAKE_MIN_LOOP);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

export interface ParticipationTier {
  name: string;
  /** Governance weight — feeds proportional proposal voting power later (v2). */
  weight: number;
}

/**
 * The tier `amount` (whole $LOOP) qualifies for, or null below the floor.
 * Thresholds are tunable; weights feed proportional governance later.
 */
export function participationTier(amount: number): ParticipationTier | null {
  if (!Number.isFinite(amount) || amount < stakeMin()) return null;
  if (amount >= 1_000_000) return { name: "Patron", weight: 10 };
  if (amount >= 100_000) return { name: "Backer", weight: 3 };
  return { name: "Member", weight: 1 };
}

/**
 * The participation gate: an explicit stake of ≥ the floor AND live on-chain
 * holdings that still cover the floor. Live balance is authoritative — with no
 * custody in v1 it can't be gamed by staking then dumping, so callers re-read it.
 */
export function canParticipate(stakedAmount: number, liveBalance: number): boolean {
  const min = stakeMin();
  return (
    Number.isFinite(stakedAmount) &&
    stakedAmount >= min &&
    Number.isFinite(liveBalance) &&
    liveBalance >= min
  );
}

/** Clamp a requested stake to a sane whole-token integer (≥ 0). */
export function sanitizeStakeAmount(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Canonical message a wallet signs to stake — the server verifies the ed25519
 * signature (verifyStakeProof) before recording a `stakes` row. Mirrors
 * buildDirectiveMessage; the trailing `ts:` enables anti-replay.
 */
export function buildStakeMessage(
  projectKey: string,
  amount: number,
  ts: number
): string {
  return `loop.fun stake\nproject:${projectKey}\namount:${sanitizeStakeAmount(amount)}\nts:${ts}`;
}

/** A `public.stakes` row (snake_case columns). */
export interface StakeRow {
  id: string;
  project_key: string;
  wallet: string;
  amount: number;
  active: boolean;
  created_at: string;
}
