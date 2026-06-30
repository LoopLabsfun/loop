import { describe, it, expect } from "vitest";
import {
  sanitizeProjectPatch,
  normalizeTwitter,
  normalizeTelegram,
  normalizeDiscord,
  normalizeWebsite,
  restrictPatchForRole,
} from "./admin-projects";

describe("restrictPatchForRole", () => {
  const full = {
    name: "N",
    description: "D",
    twitter: "@x",
    website: "foo.com",
    tokenImageUrl: "u",
    bannerUrl: "b",
    feeFounderPct: 40,
    prompt: "P",
    repo: "github.com/o/r",
    guardrails: "G",
    contentPolicy: "C",
  };

  it("passes everything through for the super-admin", () => {
    expect(restrictPatchForRole(full, "admin")).toEqual(full);
  });

  it("keeps only brand + social for a creator", () => {
    expect(restrictPatchForRole(full, "creator")).toEqual({
      name: "N",
      description: "D",
      twitter: "@x",
      website: "foo.com",
      tokenImageUrl: "u",
      bannerUrl: "b",
    });
  });

  it("drops fee/prompt/repo/guardrails/contentPolicy for a creator", () => {
    const out = restrictPatchForRole(full, "creator");
    for (const k of ["feeFounderPct", "prompt", "repo", "guardrails", "contentPolicy"]) {
      expect(k in out).toBe(false);
    }
  });
});

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

  it("normalizes social links to canonical URLs and maps to snake_case", () => {
    const p = sanitizeProjectPatch({
      twitter: "@loop",
      telegram: "t.me/looplabs",
      discord: "discord.gg/abc123",
      website: "looplabs.fun",
    });
    expect(p).toEqual({
      twitter: "https://x.com/loop",
      telegram: "https://t.me/looplabs",
      discord: "https://discord.gg/abc123",
      website: "https://looplabs.fun",
    });
  });

  it("clears a social link when the input is empty or invalid (null)", () => {
    expect(sanitizeProjectPatch({ twitter: "" }).twitter).toBe(null);
    expect(sanitizeProjectPatch({ website: "not a url" }).website).toBe(null);
    // present-but-null is still written (so a link can be removed)
    expect("twitter" in sanitizeProjectPatch({ twitter: "" })).toBe(true);
  });
});

describe("social-link normalizers", () => {
  it("twitter: handle or URL → https://x.com/<handle>", () => {
    expect(normalizeTwitter("@Loop")).toBe("https://x.com/Loop");
    expect(normalizeTwitter("loop")).toBe("https://x.com/loop");
    expect(normalizeTwitter("https://twitter.com/loop/")).toBe("https://x.com/loop");
    expect(normalizeTwitter("https://x.com/loop?ref=1")).toBe("https://x.com/loop");
    expect(normalizeTwitter("way too long a handle here")).toBe(null);
    expect(normalizeTwitter("")).toBe(null);
  });

  it("telegram: handle or t.me URL → https://t.me/<name>", () => {
    expect(normalizeTelegram("@looplabs")).toBe("https://t.me/looplabs");
    expect(normalizeTelegram("https://t.me/looplabs")).toBe("https://t.me/looplabs");
    expect(normalizeTelegram("ab")).toBe(null); // too short
  });

  it("discord: invite URL or code → https://discord.gg/<code>", () => {
    expect(normalizeDiscord("discord.gg/abc123")).toBe("https://discord.gg/abc123");
    expect(normalizeDiscord("https://discord.com/invite/abc123")).toBe("https://discord.gg/abc123");
    expect(normalizeDiscord("abc123")).toBe("https://discord.gg/abc123");
    expect(normalizeDiscord("not a discord")).toBe(null);
  });

  it("website: bare host or URL → canonical https, rejects junk", () => {
    expect(normalizeWebsite("looplabs.fun")).toBe("https://looplabs.fun");
    expect(normalizeWebsite("http://x.io/path/")).toBe("http://x.io/path");
    expect(normalizeWebsite("javascript:alert(1)")).toBe(null);
    expect(normalizeWebsite("nodot")).toBe(null);
  });
});
