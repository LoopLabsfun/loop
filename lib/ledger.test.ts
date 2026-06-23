import { describe, it, expect } from "vitest";
import {
  loopLedger,
  withCompute,
  ledgerSummary,
  monthsBetween,
  runwayMonths,
  LEDGER_GENESIS,
} from "./ledger";

describe("loopLedger", () => {
  it("lists the real named bills with sane shapes", () => {
    const e = loopLedger();
    const ids = e.map((x) => x.id).sort();
    expect(ids).toEqual(["claude", "dexscreener", "e2b", "vercel", "x-premium"]);
    // every amount is a non-negative finite number
    for (const x of e) expect(x.usd).toBeGreaterThanOrEqual(0);
    // the one-off is DexScreener at $299 USDC
    const dex = e.find((x) => x.id === "dexscreener")!;
    expect(dex.cadence).toBe("once");
    expect(dex.usd).toBe(299);
    expect(dex.currency).toBe("USDC");
  });

  it("marks Claude as the metered line, starting at 0", () => {
    const claude = loopLedger().find((x) => x.id === "claude")!;
    expect(claude.cadence).toBe("metered");
    expect(claude.usd).toBe(0);
  });
});

describe("withCompute", () => {
  it("overlays measured Claude spend onto the metered line only", () => {
    const out = withCompute(loopLedger(), 42.5);
    expect(out.find((x) => x.id === "claude")!.usd).toBe(42.5);
    // fixed lines untouched
    expect(out.find((x) => x.id === "vercel")!.usd).toBe(20);
  });

  it("leaves the placeholder at 0 when spend is null/NaN", () => {
    expect(withCompute(loopLedger(), null).find((x) => x.id === "claude")!.usd).toBe(0);
    expect(withCompute(loopLedger(), NaN).find((x) => x.id === "claude")!.usd).toBe(0);
  });

  it("clamps a negative spend to 0", () => {
    expect(withCompute(loopLedger(), -5).find((x) => x.id === "claude")!.usd).toBe(0);
  });
});

describe("monthsBetween", () => {
  it("is 0 for now/future dates", () => {
    expect(monthsBetween(LEDGER_GENESIS, new Date(LEDGER_GENESIS))).toBe(0);
    expect(monthsBetween("2030-01-01T00:00:00Z", new Date("2026-01-01T00:00:00Z"))).toBe(0);
  });

  it("counts ~1 month after ~30.44 days", () => {
    const start = new Date("2026-06-16T00:00:00Z");
    const month = new Date(start.getTime() + 30.44 * 24 * 60 * 60 * 1000);
    expect(monthsBetween(start.toISOString(), month)).toBeCloseTo(1, 4);
  });
});

describe("ledgerSummary", () => {
  const now = new Date("2026-07-16T00:00:00Z"); // ~1 month after genesis

  it("sums one-offs + recurring×months + metered", () => {
    const entries = withCompute(loopLedger(), 100);
    const s = ledgerSummary(entries, { now });
    expect(s.monthlyRecurringUsd).toBe(30); // 20 + 5 + 5
    expect(s.meteredToDateUsd).toBe(100);
    // ~1 month: 299 one-off + 30×~1 recurring + 100 metered ≈ 429
    expect(s.spentToDateUsd).toBeGreaterThan(425);
    expect(s.spentToDateUsd).toBeLessThan(435);
  });

  it("projects monthly burn as recurring + metered run-rate", () => {
    const entries = withCompute(loopLedger(), 100);
    const s = ledgerSummary(entries, { now });
    // run-rate ≈ 100/month over ~1 elapsed month → ~130/mo
    expect(s.projectedMonthlyUsd).toBeGreaterThan(125);
    expect(s.projectedMonthlyUsd).toBeLessThan(135);
  });

  it("does not blow up the run-rate in the first hours (months≈0)", () => {
    const entries = withCompute(loopLedger(), 100);
    const s = ledgerSummary(entries, { now: new Date(LEDGER_GENESIS) });
    expect(s.projectedMonthlyUsd).toBe(30); // metered run-rate suppressed
  });
});

describe("runwayMonths", () => {
  it("treasury ÷ projected burn", () => {
    expect(runwayMonths(300, 30)).toBe(10);
  });
  it("is Infinity with no burn", () => {
    expect(runwayMonths(100, 0)).toBe(Infinity);
  });
  it("is 0 with an empty treasury", () => {
    expect(runwayMonths(0, 30)).toBe(0);
  });
});
