import { describe, it, expect } from "vitest";
import { buildQuoteQuery, executeBuyback, executeSwap, SOL_MINT } from "./agent-actions-exec";
import { XSTOCKS } from "./xstocks";

const MINT = "Se8RYFmRJephMKPiCeXVGRtbNtvuZRhu6HF9pVHwvzH";

describe("buildQuoteQuery", () => {
  it("encodes a SOL→token ExactIn quote in lamports", () => {
    const q = buildQuoteQuery({ outputMint: MINT, amountSol: 0.25, slippageBps: 50 });
    expect(q).toContain(`inputMint=${SOL_MINT}`);
    expect(q).toContain(`outputMint=${MINT}`);
    expect(q).toContain("amount=250000000"); // 0.25 SOL in lamports
    expect(q).toContain("slippageBps=50");
    expect(q).toContain("swapMode=ExactIn");
  });

  it("targets a live Jupiter host, not the sunset quote-api.jup.ag/v6", () => {
    const q = buildQuoteQuery({ outputMint: MINT, amountSol: 0.1 });
    expect(q).not.toContain("quote-api.jup.ag");
    expect(q.startsWith("https://lite-api.jup.ag/swap/v1/quote")).toBe(true);
  });
});

describe("executeBuyback — policy gate (no network)", () => {
  it("rejects non-buyback actions", async () => {
    const r = await executeBuyback(
      { kind: "burn", amountTokens: 100 },
      { outputMint: MINT, cluster: "devnet" }
    );
    expect(r.executed).toBe(false);
    expect(r.reason).toMatch(/Not a buyback/);
  });

  it("escalates an oversized buyback before any signing/network", async () => {
    const r = await executeBuyback(
      { kind: "buyback", amountSol: 999 }, // over per-action cap
      { outputMint: MINT, cluster: "devnet" }
    );
    expect(r.executed).toBe(false);
    expect(r.escalated).toBe(true);
    expect(r.simulated).toBe(false);
  });

  it("denies a zero-SOL buyback before any signing/network (not 'simulated')", async () => {
    const r = await executeBuyback(
      { kind: "buyback", amountSol: 0 },
      { outputMint: MINT, cluster: "mainnet" }
    );
    expect(r.executed).toBe(false);
    expect(r.simulated).toBe(false);
    expect(r.reason).toMatch(/zero amount/i);
  });
});

describe("executeSwap — treasury portfolio (policy gate, no network)", () => {
  const AAPLX = XSTOCKS[0].mint;

  it("rejects non-swap actions", async () => {
    const r = await executeSwap({ kind: "buyback", amountSol: 0.1 }, { cluster: "devnet" });
    expect(r.executed).toBe(false);
    expect(r.reason).toMatch(/Not a swap/);
  });

  it("rejects a swap with no outputMint before any network call", async () => {
    const r = await executeSwap({ kind: "swap", amountSol: 0.1 }, { cluster: "devnet" });
    expect(r.executed).toBe(false);
    expect(r.reason).toMatch(/outputMint/);
  });

  it("denies a swap to an unverified mint (never reaches signing)", async () => {
    const r = await executeSwap(
      { kind: "swap", amountSol: 0.1, outputMint: "11111111111111111111111111111111" },
      { cluster: "devnet" }
    );
    expect(r.executed).toBe(false);
    expect(r.escalated).toBe(false);
    expect(r.reason).toMatch(/not a verified xStock/);
  });

  it("escalates an oversized portfolio swap before any signing/network", async () => {
    const r = await executeSwap(
      { kind: "swap", amountSol: 999, outputMint: AAPLX },
      { cluster: "devnet" }
    );
    expect(r.executed).toBe(false);
    expect(r.escalated).toBe(true);
  });
});
