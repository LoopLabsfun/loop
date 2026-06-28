// ─────────────────────────────────────────────────────────────────────────────
// PRE-LAUNCH GATE — submitting a pre-launch project draft (a "whitelist request")
// costs an entry toll: a SOL fee AND 1,000,000 $LOOP paid to the platform. This
// filters farmers, creates real demand on the token, and makes a request a
// commitment. Both legs are verified on-chain (verifySolPayment / verifySplPayment)
// and replay-guarded by unique sig columns on launch_waitlist.
//
// DISABLED by default (mirrors lib/launch-fee): the gate is required only once a
// collector wallet AND at least one positive leg are configured — so the current
// free, signature-only submit keeps working until the founder arms it. The toll is
// charged on the FIRST submit only; refining an existing draft is free.
//
// Pure config, env-injectable + unit-testable. No I/O.
// ─────────────────────────────────────────────────────────────────────────────

const LAMPORTS_PER_SOL = 1_000_000_000;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Env = Record<string, string | undefined>;

/** The SOL entry fee in lamports (0n when unset/invalid/non-positive). */
export function gateFeeLamports(env: Env = process.env): bigint {
  const sol = Number(env.GATE_FEE_SOL);
  if (!Number.isFinite(sol) || sol <= 0) return BigInt(0);
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}

/** The $LOOP amount (UI units) required to submit, e.g. 1_000_000. 0 when unset. */
export function gateLoopAmount(env: Env = process.env): number {
  const n = Number(env.GATE_LOOP_AMOUNT);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The platform wallet that collects the toll, or null when unset/malformed. */
export function gateWallet(env: Env = process.env): string | null {
  const w = (env.GATE_WALLET ?? env.PLATFORM_WALLET ?? "").trim();
  return BASE58.test(w) ? w : null;
}

/** The $LOOP mint to check the SPL leg against (GATE_LOOP_MINT or LOOP_MINT). */
export function gateLoopMint(env: Env = process.env): string | null {
  const m = (env.GATE_LOOP_MINT ?? env.LOOP_MINT ?? "").trim();
  return BASE58.test(m) ? m : null;
}

/** Whether the $LOOP leg is enforced (a positive amount AND a known mint). */
export function gateLoopRequired(env: Env = process.env): boolean {
  return gateLoopAmount(env) > 0 && gateLoopMint(env) !== null;
}

/** Whether the SOL leg is enforced (a positive fee). */
export function gateFeeRequired(env: Env = process.env): boolean {
  return gateFeeLamports(env) > BigInt(0);
}

/** Whether the gate is enforced at all: a collector wallet AND at least one leg. */
export function gateRequired(env: Env = process.env): boolean {
  return gateWallet(env) !== null && (gateFeeRequired(env) || gateLoopRequired(env));
}
