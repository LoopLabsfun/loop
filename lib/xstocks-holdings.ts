import "server-only";
import { getSplBalanceCached, type Network } from "./solana";
import { getMarketStats } from "./market";
import { XSTOCKS } from "./xstocks";

// Live xStocks positions held by a project's treasury wallet — the "Holdings"
// line on the treasury card (v3 plan, axe B #4). Same read pattern as
// profile-data.ts's getPositions: SPL balance per mint, priced via the same
// DexScreener-backed getMarketStats() the token page already uses (xStocks
// trade on real AMM pools, so it's a plain mint lookup, not pump.fun-specific).
// xStocks only exist on mainnet — never queried for a devnet project.

export interface XStockHolding {
  symbol: string;
  underlying: string;
  amount: number;
  valueUsd: number | null;
}

export async function getTreasuryXStockHoldings(
  treasuryWallet: string | null | undefined,
  network: Network | undefined
): Promise<XStockHolding[]> {
  if (!treasuryWallet || network !== "mainnet") return [];
  const held = await Promise.all(
    XSTOCKS.map(async (s): Promise<XStockHolding | null> => {
      const amount = await getSplBalanceCached(treasuryWallet, s.mint, "mainnet");
      if (!amount || amount <= 0) return null;
      const stats = await getMarketStats(s.mint);
      const valueUsd = stats && stats.priceUsd > 0 ? amount * stats.priceUsd : null;
      return { symbol: s.symbol, underlying: s.underlying, amount, valueUsd };
    })
  );
  return held
    .filter((x): x is XStockHolding => x !== null)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0) || b.amount - a.amount);
}
