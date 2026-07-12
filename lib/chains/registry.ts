// Per-chain metadata registry — the single place the UI and server read chain
// facts from (native symbol, explorer links, address shape). Pure and
// dependency-free so it's importable from Client and Server Components alike.
// See docs/multichain-hood.md for the full multichain plan.

import type { Chain, ChainInfo } from "./types";

/** Robinhood Chain (Arbitrum Orbit L2). */
export const HOOD_CHAIN_ID = 4663;
export const HOOD_DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const HOOD_EXPLORER = "https://robinhoodchain.blockscout.com";

const REGISTRY: Record<Chain, ChainInfo> = {
  solana: {
    chain: "solana",
    label: "Solana",
    nativeSymbol: "SOL",
    nativeDecimals: 9,
    addressKind: "base58",
    evmChainId: null,
    explorerAddress: (address) => `https://solscan.io/account/${address}`,
    explorerTx: (sig) => `https://solscan.io/tx/${sig}`,
  },
  hood: {
    chain: "hood",
    label: "Hood",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    addressKind: "evm",
    evmChainId: HOOD_CHAIN_ID,
    explorerAddress: (address) => `${HOOD_EXPLORER}/address/${address}`,
    explorerTx: (sig) => `${HOOD_EXPLORER}/tx/${sig}`,
  },
};

export function chainInfo(chain: Chain): ChainInfo {
  return REGISTRY[chain];
}

// Base58 pubkey shape (no 0, O, I, l), 32–44 chars — same shape lib/solana.ts uses.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM = /^0x[0-9a-fA-F]{40}$/;

/** Whether `address` is shaped like a valid address on `chain`. */
export function isAddressForChain(address: string, chain: Chain): boolean {
  return chain === "hood" ? EVM.test(address) : BASE58.test(address);
}

/** Best-effort chain inference from an address shape (0x… ⇒ hood). Used when
 *  migrating rows that predate the `chain` column. */
export function chainOfAddress(address: string): Chain | null {
  if (EVM.test(address)) return "hood";
  if (BASE58.test(address)) return "solana";
  return null;
}
