// HoodLauncher (Robinhood Chain, id 4663) contract constants — deployed
// addresses + function selectors for the read path. Pure/dependency-free so
// both the server reader (lib/chains/hood.ts) and future client trading can
// share it. The full ABI (for wagmi writes) lives in the sibling repo
// dev/hood/web/lib/config.ts; here we only need what the read path calls.
// See docs/multichain-hood.md.

/** Verified on-chain 2026-07-18 (router.factory() self-consistent, chainId
 *  0x1237 = 4663). Re-verify on robinhoodchain.blockscout.com before relying
 *  on these for a mainnet deploy. */
export const UNISWAP_V2_ROUTER = "0x89e5db8b5aa49aa85ac63f691524311aeb649eba";
export const UNISWAP_V2_FACTORY = "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f";
/** Wrapped ETH on Hood (router.WETH()). */
export const HOOD_WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";

/** The deployed HoodLauncher address, once live (env-gated — null until set).
 *  NEXT_PUBLIC_ so the client trading path can read it too. Read at call time
 *  (not a module const) so it reflects the runtime env and stays testable. */
export function hoodLauncherAddress(): string | null {
  return (process.env.NEXT_PUBLIC_HOOD_LAUNCHER_ADDRESS || "").trim() || null;
}

// Function selectors (keccak256(sig)[:4]), computed with `cast sig`.
export const SELECTOR = {
  /** curves(address) → (uint128 virtualEth, uint128 virtualTokens, uint128 realEth,
   *  uint128 target, uint32 feeBps, uint32 migrationBps, address creator, bool migrated) */
  curves: "0x2cc3dc6e",
  /** quoteBuy(address,uint256) → uint256 tokensOut */
  quoteBuy: "0x0d7a94f6",
  /** quoteSell(address,uint256) → uint256 ethOut */
  quoteSell: "0xd98b2f5c",
  /** creationFee() → uint256 */
  creationFee: "0xdce0b4e4",
} as const;

/** Total supply every CurveToken mints (1B, 18 decimals) — the mcap multiplier. */
export const CURVE_TOTAL_SUPPLY = 1_000_000_000;
