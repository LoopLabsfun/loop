import type { BridgeChain } from "./bridge";

// Curated token lists per chain for the in-app cross-chain swap. Addresses +
// decimals verified against Relay's /currencies/v2. Native tokens use the same
// placeholder addresses Relay expects (SOL = the 32-ones system address, ETH =
// the zero address). A project's own launcher token is injected contextually
// (addToken) so a token page can offer "swap anything -> this token".

export interface SwapToken {
  chain: BridgeChain;
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  /** True for the chain's gas token (SOL / ETH). */
  native?: boolean;
}

export const SOL_NATIVE = "11111111111111111111111111111111";
export const ETH_NATIVE = "0x0000000000000000000000000000000000000000";

const SOLANA_TOKENS: SwapToken[] = [
  { chain: "solana", symbol: "SOL", name: "Solana", address: SOL_NATIVE, decimals: 9, native: true },
  { chain: "solana", symbol: "USDC", name: "USD Coin", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  { chain: "solana", symbol: "USDT", name: "Tether USD", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  { chain: "solana", symbol: "USDG", name: "Global Dollar", address: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH", decimals: 6 },
];

const HOOD_TOKENS: SwapToken[] = [
  { chain: "hood", symbol: "ETH", name: "Ether", address: ETH_NATIVE, decimals: 18, native: true },
  { chain: "hood", symbol: "USDG", name: "Global Dollar", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", decimals: 6 },
];

const REGISTRY: Record<BridgeChain, SwapToken[]> = {
  solana: SOLANA_TOKENS,
  hood: HOOD_TOKENS,
};

/** The curated token list for a chain (plus any contextual extras). */
export function tokensForChain(chain: BridgeChain, extra: SwapToken[] = []): SwapToken[] {
  const base = REGISTRY[chain];
  const seen = new Set(base.map((t) => t.address.toLowerCase()));
  const add = extra.filter((t) => t.chain === chain && !seen.has(t.address.toLowerCase()));
  return [...base, ...add];
}

/** Default token for a chain — the native gas token. */
export function defaultToken(chain: BridgeChain): SwapToken {
  return REGISTRY[chain][0];
}

export function findToken(chain: BridgeChain, address: string): SwapToken | undefined {
  return tokensForChain(chain).find((t) => t.address.toLowerCase() === address.toLowerCase());
}
