import { describe, it, expect } from "vitest";
import { combineCrossChainBuy, combineCrossChainBuyToSolana } from "./cross-chain-buy";
import type { NormalizedBridgeQuote } from "./bridge";

// A bridge leg like the real Relay quote for 0.1 SOL -> Hood ETH.
const BRIDGE: NormalizedBridgeQuote = {
  in: { amount: "100000000", formatted: "0.1", symbol: "SOL", decimals: 9 },
  out: {
    amount: "3994128844328256",
    formatted: "0.003994128844328256",
    symbol: "ETH",
    decimals: 18,
    usd: 7.44,
  },
  rate: 0.0399,
  totalFeesUsd: 0.15,
  etaSeconds: 2,
  stepCount: 1,
};

describe("combineCrossChainBuy", () => {
  it("carries the pay + bridged legs and exposes bridged wei for leg B", () => {
    const q = combineCrossChainBuy("SOL", BRIDGE, null, "FORGE");
    expect(q.pay).toEqual({ amount: "0.1", symbol: "SOL" });
    expect(q.bridged.symbol).toBe("ETH");
    expect(q.bridged.wei).toBe(BigInt("3994128844328256"));
    expect(q.bridgeFeesUsd).toBe(0.15);
    expect(q.etaSeconds).toBe(2);
  });

  it("is NOT ready (token leg null) until the launcher quotes", () => {
    const q = combineCrossChainBuy("SOL", BRIDGE, null, "FORGE");
    expect(q.token).toBeNull();
    expect(q.ready).toBe(false);
  });

  it("fills the token leg once the launcher returns a quote", () => {
    // 1,234,567.89 tokens (18 decimals)
    const tokenOut = BigInt("1234567890000000000000000");
    const q = combineCrossChainBuy("SOL", BRIDGE, tokenOut, "FORGE");
    expect(q.ready).toBe(true);
    expect(q.token).toEqual({ amount: "1234567.89", symbol: "FORGE" });
  });

  it("degrades safely on a garbage bridged amount", () => {
    const bad: NormalizedBridgeQuote = {
      ...BRIDGE,
      out: { ...BRIDGE.out, amount: "not-a-number" },
    };
    const q = combineCrossChainBuy("SOL", bad, null, "FORGE");
    expect(q.bridged.wei).toBe(BigInt(0));
  });
});

// The mirror leg: 0.004 ETH on Hood -> SOL on Solana.
const BRIDGE_TO_SOL: NormalizedBridgeQuote = {
  in: { amount: "4000000000000000", formatted: "0.004", symbol: "ETH", decimals: 18 },
  out: {
    amount: "100000000",
    formatted: "0.1",
    symbol: "SOL",
    decimals: 9,
    usd: 14.2,
  },
  rate: 25,
  totalFeesUsd: 0.18,
  etaSeconds: 3,
  stepCount: 1,
};

describe("combineCrossChainBuyToSolana", () => {
  it("carries the pay + bridged legs (ETH in, SOL out)", () => {
    const q = combineCrossChainBuyToSolana("ETH", BRIDGE_TO_SOL, null, "LOOP");
    expect(q.pay).toEqual({ amount: "0.004", symbol: "ETH" });
    expect(q.bridged.symbol).toBe("SOL");
    expect(q.bridged.wei).toBe(BigInt("100000000"));
    expect(q.bridgeFeesUsd).toBe(0.18);
    expect(q.etaSeconds).toBe(3);
  });

  it("prices the token leg off the live SOL price", () => {
    // 0.1 SOL bridged at 0.000001 SOL/token = 100,000 tokens.
    const q = combineCrossChainBuyToSolana("ETH", BRIDGE_TO_SOL, 0.000001, "LOOP");
    expect(q.token).toEqual({ amount: "100,000", symbol: "LOOP" });
    expect(q.ready).toBe(true);
  });

  it("is NOT ready when the token has no live price (pre-launch / failed read)", () => {
    for (const price of [null, 0, -1]) {
      const q = combineCrossChainBuyToSolana("ETH", BRIDGE_TO_SOL, price, "LOOP");
      expect(q.token).toBeNull();
      expect(q.ready).toBe(false);
    }
  });

  it("is NOT ready when the bridge returns nothing", () => {
    const empty = { ...BRIDGE_TO_SOL, out: { ...BRIDGE_TO_SOL.out, amount: "0" } };
    const q = combineCrossChainBuyToSolana("ETH", empty, 0.000001, "LOOP");
    expect(q.token).toBeNull();
    expect(q.ready).toBe(false);
  });
});
