// The xStocks registry — tokenized US equities/ETFs on Solana, issued by
// Backed Finance, tradable through the same Jupiter route the agent's buyback
// already uses. Mint addresses verified LIVE against Jupiter's indexed token
// list (lite-api.jup.ag/tokens/v2/search) on 2026-07-21 — never hand-typed, so
// there's no risk of a typo'd/lookalike mint entering the agent's swap target
// allowlist. This module is the SECURITY boundary (is this address really a
// listed xStock?), not a financial-picks curation — see lib/agent-actions.ts
// for why: the agent chooses which/when/how much itself, within its existing
// per-action/daily SOL caps; this registry only stops it from ever routing
// treasury funds to a scam token that merely LOOKS like "AAPLx".
//
// Pure + dependency-free (mirrors lib/relay-tokens.ts's shape). Re-verify /
// extend via `curl https://lite-api.jup.ag/tokens/v2/search?query=<TICKER>`.

export interface XStock {
  /** e.g. "AAPLx" — Backed's on-chain ticker convention (real symbol + "x"). */
  symbol: string;
  /** The company/index this token tracks, e.g. "Apple". */
  underlying: string;
  mint: string;
  decimals: number;
}

export const XSTOCKS: XStock[] = [
  { symbol: "AAPLx", underlying: "Apple", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", decimals: 8 },
  { symbol: "TSLAx", underlying: "Tesla", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", decimals: 8 },
  { symbol: "NVDAx", underlying: "NVIDIA", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8 },
  { symbol: "SPYx", underlying: "S&P 500", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 8 },
  { symbol: "GOOGLx", underlying: "Alphabet", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", decimals: 8 },
  { symbol: "MSFTx", underlying: "Microsoft", mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", decimals: 8 },
  { symbol: "METAx", underlying: "Meta", mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", decimals: 8 },
  { symbol: "AMZNx", underlying: "Amazon", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 8 },
  { symbol: "QQQx", underlying: "Nasdaq 100", mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", decimals: 8 },
  { symbol: "COINx", underlying: "Coinbase", mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", decimals: 8 },
  { symbol: "MSTRx", underlying: "MicroStrategy", mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", decimals: 8 },
  { symbol: "HOODx", underlying: "Robinhood", mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg", decimals: 8 },
];

const BY_MINT = new Map(XSTOCKS.map((s) => [s.mint, s]));
const BY_SYMBOL = new Map(XSTOCKS.map((s) => [s.symbol.toLowerCase(), s]));

/** True only for a mint address that's a verified, listed xStock. */
export function isXStockMint(mint: string | undefined | null): boolean {
  return !!mint && BY_MINT.has(mint);
}

export function xstockByMint(mint: string): XStock | undefined {
  return BY_MINT.get(mint);
}

export function xstockBySymbol(symbol: string): XStock | undefined {
  return BY_SYMBOL.get(symbol.toLowerCase());
}
