// ─────────────────────────────────────────────────────────────────────────────
// FEE ATTRIBUTION — split a shared creator-fee claim across the projects that
// share one on-chain pump.fun creator wallet.
//
// pump.fun's `collectCreatorFee` sweeps EVERY token of a creator wallet in one
// tx and reports only a single lump (no per-mint breakdown). When several Loop
// projects were launched from the same signer (so they share one
// `feeCreatorWallet`), that lump must be attributed back to each project before
// the 30/65/5 split can route the right amount to each project's founder/agent.
//
// We can't get the exact per-token figure on-chain, so attribution is by WEIGHT
// (each project's recent trading volume) — the same proportion that produced the
// fees. With no usable weights it falls back to an EQUAL split, so a fresh group
// (no volume yet) still attributes deterministically instead of dropping funds.
//
// Pure, no I/O, fully unit-tested. The amounts always re-sum to the input lump
// (rounding remainder lands on the first project) so nothing is created or lost.
// ─────────────────────────────────────────────────────────────────────────────

export interface AttributionInput {
  /** Project key. */
  key: string;
  /** Non-negative weight (e.g. recent volume in SOL). <=0 / non-finite ⇒ 0. */
  weight: number;
}

export interface Attribution {
  key: string;
  /** SOL attributed to this project from the claimed lump. */
  sol: number;
}

function round9(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

const w = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Attribute `claimedSol` across `group` proportional to each project's weight.
 * Falls back to an equal split when every weight is 0. The parts always re-sum to
 * `claimedSol` exactly (the rounding remainder is added to the first project).
 * Returns [] for an empty group or a non-positive claim.
 */
export function attributeClaim(
  claimedSol: number,
  group: AttributionInput[]
): Attribution[] {
  const amt = Number.isFinite(claimedSol) && claimedSol > 0 ? claimedSol : 0;
  if (amt <= 0 || group.length === 0) {
    return group.map((g) => ({ key: g.key, sol: 0 }));
  }
  const weights = group.map((g) => w(g.weight));
  const total = weights.reduce((s, x) => s + x, 0);
  // Equal split when there's no signal to weight by.
  const fractions =
    total > 0
      ? weights.map((x) => x / total)
      : group.map(() => 1 / group.length);

  const out = group.map((g, i) => ({ key: g.key, sol: round9(amt * fractions[i]) }));
  // Re-sum exactly: dump any rounding drift onto the first project.
  const sum = round9(out.reduce((s, x) => s + x.sol, 0));
  const drift = round9(amt - sum);
  if (drift !== 0 && out.length > 0) out[0].sol = round9(out[0].sol + drift);
  return out;
}

/**
 * Parse a stored volume string ("12.3 SOL", "$30K", "—") into a numeric weight.
 * Only SOL-denominated values are usable as a fee weight; anything else (fiat
 * mcap, em-dash placeholder) yields 0 so the group falls back to an equal split
 * rather than weighting by an incomparable unit.
 */
export function volumeWeight(volume24h: string | null | undefined): number {
  if (!volume24h) return 0;
  const m = /(-?\d+(?:\.\d+)?)\s*SOL/i.exec(volume24h);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
