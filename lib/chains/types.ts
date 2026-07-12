// The chain dimension: which L1/L2 a project lives on. Orthogonal to
// `Network` (lib/types.ts), which remains the Solana cluster switch
// (mainnet/devnet) — Hood is mainnet-only. See docs/multichain-hood.md.

export type Chain = "solana" | "hood";

export const CHAINS: readonly Chain[] = ["solana", "hood"] as const;

export function isChain(v: unknown): v is Chain {
  return v === "solana" || v === "hood";
}

/** Address encoding used by a chain. */
export type AddressKind = "base58" | "evm";

/** Static metadata for a chain, consumed by UI (symbols, explorer links) and
 *  by the server read path (RPC endpoint selection). */
export interface ChainInfo {
  chain: Chain;
  /** Display name ("Solana", "Hood"). */
  label: string;
  /** Native currency ticker the UI shows next to treasury/trade amounts. */
  nativeSymbol: string;
  nativeDecimals: number;
  addressKind: AddressKind;
  /** EVM chain id; null for non-EVM chains. */
  evmChainId: number | null;
  /** Address page on the chain's canonical explorer. */
  explorerAddress: (address: string) => string;
  /** Transaction page on the chain's canonical explorer. */
  explorerTx: (sig: string) => string;
}
