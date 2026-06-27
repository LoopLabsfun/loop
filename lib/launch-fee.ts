// Pure config for pay-to-launch (the launch toll). Launching a project requires
// a SOL payment to the platform launch wallet, verified on-chain (lib/solana
// verifySolPayment) before any project row is written — closing the "anyone can
// spam free rows" surface of the open-launch prototype.
//
// Disabled by default: returns 0 / null / false unless BOTH a positive
// LAUNCH_FEE_SOL and a valid LAUNCH_FEE_WALLET are set, so devnet/prototype and
// the LOOP-only phase keep working untolled. No I/O — env-injectable + unit-
// testable, same posture as the other config readers in the repo.

const LAMPORTS_PER_SOL = 1_000_000_000;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Env = Record<string, string | undefined>;

/** The launch fee in lamports (0n when unset/invalid/non-positive). */
export function launchFeeLamports(env: Env = process.env): bigint {
  const sol = Number(env.LAUNCH_FEE_SOL);
  if (!Number.isFinite(sol) || sol <= 0) return BigInt(0);
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}

/** The platform wallet that collects launch fees, or null when unset/malformed. */
export function launchFeeWallet(env: Env = process.env): string | null {
  const w = (env.LAUNCH_FEE_WALLET ?? "").trim();
  return BASE58.test(w) ? w : null;
}

/** Whether pay-to-launch is enforced: a positive fee AND a valid collector wallet. */
export function launchFeeRequired(env: Env = process.env): boolean {
  return launchFeeLamports(env) > BigInt(0) && launchFeeWallet(env) !== null;
}
