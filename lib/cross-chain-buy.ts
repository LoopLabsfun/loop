import { formatUnits } from "./chains/units";
import type { NormalizedBridgeQuote } from "./bridge";

// Cross-chain buy: pay SOL, receive a Hood token. Two legs held together —
//   A) bridge SOL -> ETH on Hood (real now, via /api/bridge/quote), then
//   B) buy the token on the launcher curve with that ETH (launcher.quoteBuy).
// This combines the two into one summary. Leg B is null until the launcher is
// live (NEXT_PUBLIC_HOOD_LAUNCHER_ADDRESS), so the UI shows the bridged ETH now
// and fills the token estimate the moment quoteBuy returns — no other change.
// Pure + tested; the fetching lives in the component. See docs/multichain-hood.md.

export interface CrossChainBuyQuote {
  /** What the user pays on the origin chain (e.g. 0.1 SOL). */
  pay: { amount: string; symbol: string };
  /** ETH out of the bridge — fed as wei into the launcher's quoteBuy (leg B). */
  bridged: { amount: string; symbol: string; wei: bigint };
  /** Token out of the launcher curve; null until the launcher is live. */
  token: { amount: string; symbol: string } | null;
  /** Relay bridge fees (leg A) in USD, or null. Launcher fees are on-curve. */
  bridgeFeesUsd: number | null;
  /** Bridge ETA in seconds (leg A), or null. */
  etaSeconds: number | null;
  /** True once the token leg is filled (launcher live + quoted). */
  ready: boolean;
}

function safeBigInt(s: string): bigint {
  try {
    return BigInt(s);
  } catch {
    return BigInt(0);
  }
}

/**
 * Fold the bridge leg (SOL→ETH) and the launcher buy leg (ETH→token) into one
 * quote. Pass `tokenOutWei = null` when the launcher isn't live yet (or hasn't
 * quoted): the summary then carries the bridged ETH and `ready = false`.
 * `tokenDecimals` defaults to 18 (the HoodLauncher ERC-20 standard).
 */
export function combineCrossChainBuy(
  paySymbol: string,
  bridge: NormalizedBridgeQuote,
  tokenOutWei: bigint | null,
  tokenSymbol: string,
  tokenDecimals = 18
): CrossChainBuyQuote {
  return {
    pay: { amount: bridge.in.formatted, symbol: bridge.in.symbol || paySymbol },
    bridged: {
      amount: bridge.out.formatted,
      symbol: bridge.out.symbol || "ETH",
      wei: safeBigInt(bridge.out.amount),
    },
    token:
      tokenOutWei !== null
        ? { amount: formatUnits(tokenOutWei, tokenDecimals, 4), symbol: tokenSymbol }
        : null,
    bridgeFeesUsd: bridge.totalFeesUsd,
    etaSeconds: bridge.etaSeconds,
    ready: tokenOutWei !== null,
  };
}
