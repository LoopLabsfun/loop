// Cross-chain bridge quotes (Solana <-> Hood) via Relay (relay.link). Pure
// helpers + a response normaliser so the /api/bridge/quote proxy and the UI
// share one shape, and the chain mapping / fee math is unit-tested. The network
// call itself lives in the route. See docs/multichain-hood.md "Cross-chain
// bridge" for the two-leg buy/sell flow this powers.

export type BridgeChain = "solana" | "hood";

export const RELAY_QUOTE_URL = "https://api.relay.link/quote/v2";

// Relay's own chain ids + native-currency address convention, verified against
// api.relay.link/chains and a live /quote/v2 call: Solana is a first-class SVM
// chain (native SOL = the 32-ones system address); Hood is EVM 4663 (native ETH
// = the zero address). Both are Relay-supported, so SOL<->Hood routes natively.
const RELAY: Record<BridgeChain, { chainId: number; native: string }> = {
  solana: { chainId: 792703809, native: "11111111111111111111111111111111" },
  hood: { chainId: 4663, native: "0x0000000000000000000000000000000000000000" },
};

export function relayChainId(chain: BridgeChain): number {
  return RELAY[chain].chainId;
}
export function nativeCurrency(chain: BridgeChain): string {
  return RELAY[chain].native;
}
export function isBridgeChain(v: unknown): v is BridgeChain {
  return v === "solana" || v === "hood";
}

export interface BridgeQuoteInput {
  fromChain: BridgeChain;
  toChain: BridgeChain;
  /** Depositor address on fromChain. */
  user: string;
  /** Receiver address on toChain (always the user's own wallet — never custodial). */
  recipient: string;
  /** Integer string, smallest units on fromChain (lamports / wei). */
  amount: string;
  /** Token address on fromChain; defaults to native. */
  fromCurrency?: string;
  /** Token address on toChain; defaults to native. */
  toCurrency?: string;
  /** Slippage tolerance in basis points (e.g. 100 = 1%). Omit for Relay's auto. */
  slippageBps?: number;
}

export interface RelayQuoteRequest {
  user: string;
  recipient: string;
  originChainId: number;
  destinationChainId: number;
  originCurrency: string;
  destinationCurrency: string;
  amount: string;
  tradeType: "EXACT_INPUT";
  slippageTolerance?: string;
}

export function buildRelayQuoteRequest(input: BridgeQuoteInput): RelayQuoteRequest {
  const req: RelayQuoteRequest = {
    user: input.user,
    recipient: input.recipient,
    originChainId: relayChainId(input.fromChain),
    destinationChainId: relayChainId(input.toChain),
    originCurrency: input.fromCurrency?.trim() || nativeCurrency(input.fromChain),
    destinationCurrency: input.toCurrency?.trim() || nativeCurrency(input.toChain),
    amount: input.amount,
    tradeType: "EXACT_INPUT",
  };
  if (input.slippageBps != null && Number.isFinite(input.slippageBps)) {
    req.slippageTolerance = String(Math.max(0, Math.min(10000, Math.round(input.slippageBps))));
  }
  return req;
}

// --- response normalisation ------------------------------------------------

interface RelayCurrencySide {
  amount?: string;
  amountFormatted?: string;
  amountUsd?: string;
  currency?: { symbol?: string; decimals?: number };
}
interface RelayFee {
  amountUsd?: string;
}
export interface RelayQuoteResponse {
  details?: {
    currencyIn?: RelayCurrencySide;
    currencyOut?: RelayCurrencySide;
    rate?: string | number;
    timeEstimate?: number;
  };
  fees?: Record<string, RelayFee>;
  steps?: unknown[];
}

export interface NormalizedBridgeQuote {
  in: { amount: string; formatted: string; symbol: string; decimals: number };
  out: {
    amount: string;
    formatted: string;
    symbol: string;
    decimals: number;
    usd: number | null;
  };
  rate: number | null;
  totalFeesUsd: number | null;
  etaSeconds: number | null;
  stepCount: number;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function normalizeRelayQuote(res: RelayQuoteResponse): NormalizedBridgeQuote {
  const d = res.details ?? {};
  const ci = d.currencyIn ?? {};
  const co = d.currencyOut ?? {};
  // Total user cost = origin gas + the full relayer fee. `relayer` already
  // bundles relayerGas + relayerService, so summing those too would double-count;
  // `app` is our own optional take (unset → 0).
  const gas = num(res.fees?.gas?.amountUsd) ?? 0;
  const relayer = num(res.fees?.relayer?.amountUsd) ?? 0;
  const app = num(res.fees?.app?.amountUsd) ?? 0;
  return {
    in: {
      amount: ci.amount ?? "0",
      formatted: ci.amountFormatted ?? "0",
      symbol: ci.currency?.symbol ?? "",
      decimals: ci.currency?.decimals ?? 0,
    },
    out: {
      amount: co.amount ?? "0",
      formatted: co.amountFormatted ?? "0",
      symbol: co.currency?.symbol ?? "",
      decimals: co.currency?.decimals ?? 0,
      usd: num(co.amountUsd),
    },
    rate: num(d.rate),
    totalFeesUsd: res.fees ? gas + relayer + app : null,
    etaSeconds: num(d.timeEstimate),
    stepCount: Array.isArray(res.steps) ? res.steps.length : 0,
  };
}
