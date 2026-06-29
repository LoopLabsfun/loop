import { describe, it, expect } from "vitest";
import { sanitizeProjectPatch } from "./admin-projects";

describe("sanitizeProjectPatch", () => {
  it("only touches keys that are present (partial edit)", () => {
    expect(sanitizeProjectPatch({ feeFounderPct: 40 })).toEqual({ fee_founder_pct: 40 });
    // description not in input → not in patch (so a fee edit can't blank it)
    expect("description" in sanitizeProjectPatch({ feeFounderPct: 40 })).toBe(false);
  });

  it("clamps the fee lever through makeSplit", () => {
    expect(sanitizeProjectPatch({ feeFounderPct: 200 }).fee_founder_pct).toBe(95); // max (platform fixed 5)
    expect(sanitizeProjectPatch({ feeFounderPct: -10 }).fee_founder_pct).toBe(0);
    expect(sanitizeProjectPatch({ feeFounderPct: 30.6 }).fee_founder_pct).toBe(31); // rounded
  });

  it("ignores a non-finite or null fee", () => {
    expect("fee_founder_pct" in sanitizeProjectPatch({ feeFounderPct: null })).toBe(false);
    expect("fee_founder_pct" in sanitizeProjectPatch({ feeFounderPct: NaN })).toBe(false);
  });

  it("keeps only a plausible GitHub repo, else clears it", () => {
    expect(sanitizeProjectPatch({ repo: "https://github.com/me/proj" }).repo).toBe("https://github.com/me/proj");
    expect(sanitizeProjectPatch({ repo: "not a url" }).repo).toBe(null);
  });

  it("length-caps free text and maps to snake_case columns", () => {
    const p = sanitizeProjectPatch({
      description: "  hi  ",
      prompt: "build it",
      contentPolicy: "no nsfw",
      guardrails: "stay on brand",
    });
    expect(p).toEqual({
      description: "hi",
      prompt: "build it",
      content_policy: "no nsfw",
      guardrails: "stay on brand",
    });
  });

  it("never blanks a required name (drops an empty one)", () => {
    expect("name" in sanitizeProjectPatch({ name: "   " })).toBe(false);
    expect(sanitizeProjectPatch({ name: "Petloop" }).name).toBe("Petloop");
  });

  it("returns {} when nothing valid is provided", () => {
    expect(sanitizeProjectPatch({})).toEqual({});
  });
});
