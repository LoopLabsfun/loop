import { describe, it, expect } from "vitest";
import {
  buildRelayQuoteRequest,
  normalizeRelayQuote,
  relayChainId,
  nativeCurrency,
  isBridgeChain,
  type RelayQuoteResponse,
} from "./bridge";

// Trimmed from a real api.relay.link/quote/v2 response for 0.1 SOL -> Hood ETH
// (captured 2026-07-20). Keep the field paths in sync with lib/bridge.ts.
const REAL_QUOTE: RelayQuoteResponse = {
  details: {
    currencyIn: {
      amount: "100000000",
      amountFormatted: "0.1",
      amountUsd: "15.30",
      currency: { symbol: "SOL", decimals: 9 },
    },
    currencyOut: {
      amount: "4030376421959779",
      amountFormatted: "0.004030376421959779",
      amountUsd: "7.511259",
      currency: { symbol: "ETH", decimals: 18 },
    },
    rate: "0.04030975507502309",
    timeEstimate: 2,
  },
  fees: {
    gas: { amountUsd: "0.072055" },
    relayer: { amountUsd: "0.123506" },
    relayerGas: { amountUsd: "0.079835" },
    relayerService: { amountUsd: "0.043671" },
    app: { amountUsd: "0" },
    subsidized: { amountUsd: "0" },
  },
  steps: [{}],
};

describe("bridge chain mapping", () => {
  it("maps loop chains to Relay ids", () => {
    expect(relayChainId("solana")).toBe(792703809);
    expect(relayChainId("hood")).toBe(4663);
  });
  it("uses the right native-currency address per chain", () => {
    expect(nativeCurrency("solana")).toBe("11111111111111111111111111111111");
    expect(nativeCurrency("hood")).toBe("0x0000000000000000000000000000000000000000");
  });
  it("guards the chain union", () => {
    expect(isBridgeChain("solana")).toBe(true);
    expect(isBridgeChain("hood")).toBe(true);
    expect(isBridgeChain("ethereum")).toBe(false);
    expect(isBridgeChain(4663)).toBe(false);
  });
});

describe("buildRelayQuoteRequest", () => {
  it("defaults to native currencies on both legs", () => {
    const req = buildRelayQuoteRequest({
      fromChain: "solana",
      toChain: "hood",
      user: "7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9",
      recipient: "0x16c630FaFCa17eEd7F1368ef58D08FEAd0241B23",
      amount: "100000000",
    });
    expect(req).toEqual({
      user: "7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9",
      recipient: "0x16c630FaFCa17eEd7F1368ef58D08FEAd0241B23",
      originChainId: 792703809,
      destinationChainId: 4663,
      originCurrency: "11111111111111111111111111111111",
      destinationCurrency: "0x0000000000000000000000000000000000000000",
      amount: "100000000",
      tradeType: "EXACT_INPUT",
    });
  });

  it("passes through explicit token currencies (e.g. buying a Hood token)", () => {
    const req = buildRelayQuoteRequest({
      fromChain: "solana",
      toChain: "hood",
      user: "7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9",
      recipient: "0x16c630FaFCa17eEd7F1368ef58D08FEAd0241B23",
      amount: "100000000",
      toCurrency: "0x1111111111111111111111111111111111111111",
    });
    expect(req.destinationCurrency).toBe("0x1111111111111111111111111111111111111111");
    expect(req.originCurrency).toBe("11111111111111111111111111111111");
  });
});

describe("normalizeRelayQuote", () => {
  const q = normalizeRelayQuote(REAL_QUOTE);

  it("extracts the in/out legs", () => {
    expect(q.in).toEqual({ amount: "100000000", formatted: "0.1", symbol: "SOL", decimals: 9 });
    expect(q.out.symbol).toBe("ETH");
    expect(q.out.formatted).toBe("0.004030376421959779");
    expect(q.out.usd).toBeCloseTo(7.511259, 5);
  });

  it("sums fees as gas + relayer (+app) without double-counting relayerGas/Service", () => {
    // 0.072055 + 0.123506 + 0 = 0.195561 — NOT + relayerGas + relayerService.
    expect(q.totalFeesUsd).toBeCloseTo(0.195561, 5);
  });

  it("carries rate, eta, and step count", () => {
    expect(q.rate).toBeCloseTo(0.04030975, 6);
    expect(q.etaSeconds).toBe(2);
    expect(q.stepCount).toBe(1);
  });

  it("degrades safely on an empty/garbage response", () => {
    const empty = normalizeRelayQuote({});
    expect(empty.totalFeesUsd).toBeNull();
    expect(empty.rate).toBeNull();
    expect(empty.out.amount).toBe("0");
    expect(empty.stepCount).toBe(0);
  });
});
