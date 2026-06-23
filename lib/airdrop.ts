// ─────────────────────────────────────────────────────────────────────────────
// FAIR AIRDROP — "hold-to-earn" rewards that don't just pay the whales.
//
// The agent can reward holders from its wallet. A plain pro-rata airdrop sends
// almost everything to the biggest wallets; that's neither fair nor good for the
// community. So weighting defaults to **sqrt** (quadratic-style): rewards still
// rise with holdings, but sub-linearly — a holder with 100× the bag gets ~10×
// the reward, not 100×. Small holders get a meaningful share.
//
// Anti-sybil floor (min balance to be eligible) so the reward isn't shredded
// across dust wallets, and an exclude list (treasury / agent / LP / mint wallets
// shouldn't airdrop to themselves). Pure + testable; exact re-sum, no dust.
// ─────────────────────────────────────────────────────────────────────────────

export interface Holder {
  address: string;
  /** Token balance (UI amount). */
  balance: number;
}

export interface Allocation {
  address: string;
  /** Reward amount in the pool's unit (SOL or tokens). */
  amount: number;
  /** Share of the pool, 0..1 (for display). */
  share: number;
}

export type Weighting = "sqrt" | "linear" | "equal";

export interface AirdropOptions {
  /** sqrt (default, anti-whale) | linear (pro-rata) | equal (flat per holder). */
  weighting?: Weighting;
  /** Minimum balance to be eligible (anti-sybil/dust). Default 0. */
  minBalance?: number;
  /** Wallets to exclude (treasury / agent / LP / mint). Case-sensitive. */
  exclude?: string[];
  /** Decimal precision of the pool unit for rounding. Default 9 (SOL/lamports). */
  decimals?: number;
}

export interface AirdropPlan {
  allocations: Allocation[];
  /** Eligible holders that received a non-zero amount. */
  recipients: number;
  /** Total actually distributed (re-sums to the pool, minus any zero-rounding). */
  distributed: number;
  /** Largest single recipient's share of the pool, 0..1 (whale-capture metric). */
  topShare: number;
}

function weightOf(balance: number, w: Weighting): number {
  if (w === "equal") return 1;
  if (w === "linear") return balance;
  return Math.sqrt(balance); // sqrt
}

/**
 * Compute a fair airdrop plan. Returns per-holder allocations summing to the
 * pool (rounding remainder lands on the largest recipient so nothing is lost).
 * Empty when there are no eligible holders or the pool is non-positive.
 */
export function computeAirdrop(
  holders: Holder[],
  pool: number,
  opts: AirdropOptions = {}
): AirdropPlan {
  const weighting = opts.weighting ?? "sqrt";
  const minBalance = opts.minBalance ?? 0;
  const exclude = new Set(opts.exclude ?? []);
  const decimals = opts.decimals ?? 9;
  const unit = 10 ** decimals;
  const round = (n: number) => Math.round(n * unit) / unit;

  const empty: AirdropPlan = {
    allocations: [],
    recipients: 0,
    distributed: 0,
    topShare: 0,
  };
  if (!(pool > 0)) return empty;

  const eligible = holders.filter(
    (h) =>
      Number.isFinite(h.balance) &&
      h.balance > 0 &&
      h.balance >= minBalance &&
      !exclude.has(h.address)
  );
  if (eligible.length === 0) return empty;

  const weights = eligible.map((h) => weightOf(h.balance, weighting));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (!(totalWeight > 0)) return empty;

  const allocations: Allocation[] = eligible.map((h, i) => {
    const amount = round((pool * weights[i]) / totalWeight);
    return { address: h.address, amount, share: weights[i] / totalWeight };
  });

  // Re-sum exactly: drop the rounding remainder onto the largest allocation.
  const distributed = round(allocations.reduce((a, b) => a + b.amount, 0));
  const remainder = round(pool - distributed);
  if (remainder !== 0 && allocations.length > 0) {
    let maxI = 0;
    for (let i = 1; i < allocations.length; i++) {
      if (allocations[i].amount > allocations[maxI].amount) maxI = i;
    }
    allocations[maxI] = {
      ...allocations[maxI],
      amount: round(allocations[maxI].amount + remainder),
    };
  }

  allocations.sort((a, b) => b.amount - a.amount);
  const withAmount = allocations.filter((a) => a.amount > 0);
  const finalDistributed = round(withAmount.reduce((a, b) => a + b.amount, 0));

  return {
    allocations: withAmount,
    recipients: withAmount.length,
    distributed: finalDistributed,
    topShare: withAmount.length ? withAmount[0].amount / pool : 0,
  };
}
