import { describe, it, expect } from "vitest";
import {
  buildShipSnapshot,
  parseShortAmount,
  impactScore,
  impactOutcomeNote,
  IMPACT_WINDOW_DAYS,
} from "./agent-impact";

describe("parseShortAmount", () => {
  it("parses $ short forms", () => {
    expect(parseShortAmount("$30K")).toBe(30_000);
    expect(parseShortAmount("$2.4M")).toBe(2_400_000);
    expect(parseShortAmount("$941")).toBe(941);
    expect(parseShortAmount("1.2B")).toBe(1_200_000_000);
  });
  it("parses SOL-denominated and thousands-separated values", () => {
    expect(parseShortAmount("12.3 SOL")).toBe(12.3);
    expect(parseShortAmount("$1,200")).toBe(1_200);
  });
  it("returns null for placeholders", () => {
    expect(parseShortAmount("—")).toBeNull();
    expect(parseShortAmount("")).toBeNull();
    expect(parseShortAmount(null)).toBeNull();
  });
});

describe("buildShipSnapshot", () => {
  it("captures vitals and stamps the ship time", () => {
    const now = new Date("2026-07-11T00:00:00Z");
    const s = buildShipSnapshot(
      { treasurySol: 0.42, marketCap: "$30K", volume24h: "$1.2K" },
      now
    );
    expect(s).toEqual({
      treasurySol: 0.42,
      marketCap: "$30K",
      volume24h: "$1.2K",
      at: "2026-07-11T00:00:00.000Z",
    });
  });
  it("nulls unusable readings instead of storing junk", () => {
    const s = buildShipSnapshot({ treasurySol: NaN, marketCap: "", volume24h: "" });
    expect(s.treasurySol).toBeNull();
    expect(s.marketCap).toBeNull();
  });
});

describe("impactScore", () => {
  const snap = (over: Partial<{ treasurySol: number | null; marketCap: string | null }>) => ({
    treasurySol: 1,
    marketCap: "$10K",
    ...over,
  });

  it("scores full growth on both signals at 100", () => {
    expect(
      impactScore(snap({}), { treasurySol: 1.5, marketCap: "$15K" })
    ).toBe(100);
  });
  it("scores flat vitals at the shipped baseline (10)", () => {
    expect(impactScore(snap({}), { treasurySol: 1, marketCap: "$10K" })).toBe(10);
  });
  it("declines read as no lift, never negative blame", () => {
    expect(impactScore(snap({}), { treasurySol: 0.5, marketCap: "$5K" })).toBe(10);
  });
  it("scales linearly below the +50% ceiling", () => {
    // +25% mcap = 45 * 0.5 ≈ 23 pts; treasury flat = 0; +10 baseline.
    expect(impactScore(snap({}), { treasurySol: 1, marketCap: "$12.5K" })).toBe(33);
  });
  it("works with a single comparable signal", () => {
    expect(
      impactScore(snap({ treasurySol: null }), { treasurySol: 2, marketCap: "$20K" })
    ).toBe(55);
  });
  it("returns null when there is no comparable signal at all", () => {
    expect(
      impactScore(
        { treasurySol: null, marketCap: null },
        { treasurySol: null, marketCap: "$10K" }
      )
    ).toBeNull();
    expect(
      impactScore(
        { treasurySol: 0, marketCap: "—" },
        { treasurySol: 1, marketCap: "$10K" }
      )
    ).toBeNull();
  });
});

describe("impactOutcomeNote", () => {
  it("labels the score bands and names the window", () => {
    expect(impactOutcomeNote(80)).toBe(
      `IMPACT J+${IMPACT_WINDOW_DAYS}: 80/100 (the needle moved)`
    );
    expect(impactOutcomeNote(30)).toContain("some lift");
    expect(impactOutcomeNote(10)).toContain("no visible lift");
  });
});
