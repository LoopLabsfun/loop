import { describe, it, expect } from "vitest";
import { buildQuoteQuery, executeBuyback, SOL_MINT } from "./agent-actions-exec";

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
});
