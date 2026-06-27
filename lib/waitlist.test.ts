import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  normalizeXHandle,
  normalizeTicker,
  normalizeMediaUrl,
  validateWaitlist,
  welcomeDmBody,
  PROMPT_MAX,
} from "./waitlist";
import { DEFAULT_SPLIT, MAX_FOUNDER_PCT } from "./fees";

const WALLET = "H8UMZSW2nZQm59G56UGmKAKVcgf5rcgEdFbVvcA9TSvC";

describe("normalizeEmail", () => {
  it("lowercases + trims a valid email", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
  it("rejects malformed or oversized emails", () => {
    for (const v of ["", "nope", "a@b", "a@b.", "@b.com", "x".repeat(250) + "@b.com", 5, null]) {
      expect(normalizeEmail(v as unknown)).toBeNull();
    }
  });
});

describe("normalizeXHandle", () => {
  it("strips a leading @ and keeps valid handles", () => {
    expect(normalizeXHandle("@looplabsfun")).toBe("looplabsfun");
    expect(normalizeXHandle("loop_labs")).toBe("loop_labs");
  });
  it("rejects empty, too-long, or illegal handles", () => {
    for (const v of ["", "@", "x".repeat(16), "has space", "bad-dash", 1, null]) {
      expect(normalizeXHandle(v as unknown)).toBeNull();
    }
  });
});

describe("normalizeTicker", () => {
  it("strips a leading $, uppercases, and keeps valid tickers", () => {
    expect(normalizeTicker("$oscur")).toBe("OSCUR");
    expect(normalizeTicker(" loop ")).toBe("LOOP");
    expect(normalizeTicker("A1")).toBe("A1");
  });
  it("rejects empty, too-long, or illegal tickers", () => {
    for (const v of ["", "$", "toolongticker", "bad-dash", "has space", 5, null]) {
      expect(normalizeTicker(v as unknown)).toBeNull();
    }
  });
});

describe("normalizeMediaUrl", () => {
  it("rejects non-https, oversized, or non-string urls", () => {
    expect(normalizeMediaUrl("http://x.com/a.png")).toBeNull();
    expect(normalizeMediaUrl("")).toBeNull();
    expect(normalizeMediaUrl(5 as unknown)).toBeNull();
    expect(normalizeMediaUrl("https://x.com/" + "a".repeat(500))).toBeNull();
  });
  it("requires the waitlist-media public prefix when SUPABASE_URL is set", () => {
    const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    const good = "https://abc.supabase.co/storage/v1/object/public/waitlist-media/w/banner.png";
    expect(normalizeMediaUrl(good)).toBe(good);
    expect(normalizeMediaUrl("https://evil.com/x.png")).toBeNull();
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });
});

describe("validateWaitlist", () => {
  it("requires a project name", () => {
    const r = validateWaitlist({ ticker: "LOOP" });
    expect(r.clean).toBeUndefined();
    expect(r.error).toMatch(/name/i);
  });

  it("requires a ticker", () => {
    const r = validateWaitlist({ name: "My Project" });
    expect(r.clean).toBeUndefined();
    expect(r.error).toMatch(/ticker/i);
  });

  it("accepts name + ticker, normalizing both", () => {
    const r = validateWaitlist({ name: "  Open Source Cursor ", ticker: "$oscur" });
    expect(r.error).toBeUndefined();
    expect(r.clean?.name).toBe("Open Source Cursor");
    expect(r.clean?.ticker).toBe("OSCUR");
  });

  it("clamps the fee split through makeSplit and defaults when unset", () => {
    expect(validateWaitlist({ name: "P", ticker: "P", feeFounderPct: 999 }).clean?.feeFounderPct).toBe(MAX_FOUNDER_PCT);
    expect(validateWaitlist({ name: "P", ticker: "P" }).clean?.feeFounderPct).toBe(DEFAULT_SPLIT.founderPct);
  });

  it("caps the prompt and keeps optional contacts", () => {
    const r = validateWaitlist({
      name: "P",
      ticker: "P",
      prompt: "x".repeat(PROMPT_MAX + 50),
      email: " A@B.com ",
      xHandle: "@me",
    });
    expect(r.clean?.prompt?.length).toBe(PROMPT_MAX);
    expect(r.clean?.email).toBe("a@b.com");
    expect(r.clean?.xHandle).toBe("me");
  });

  it("normalizes a referrer (wallet or X handle)", () => {
    expect(validateWaitlist({ name: "P", ticker: "P", referrer: "@ref" }).clean?.referrer).toBe("ref");
    expect(validateWaitlist({ name: "P", ticker: "P", referrer: WALLET }).clean?.referrer).toBe(WALLET);
    expect(validateWaitlist({ name: "P", ticker: "P", referrer: "!!" }).clean?.referrer).toBeNull();
  });
});

describe("welcomeDmBody", () => {
  it("echoes the project + pitch back when present", () => {
    const b = welcomeDmBody("Open Source Cursor", "an autonomous AI IDE");
    expect(b).toContain("Open Source Cursor");
    expect(b).toContain("an autonomous AI IDE");
    expect(b).toMatch(/welcome to loop/i);
  });
  it("falls back to a name-only ask when there's no pitch", () => {
    const b = welcomeDmBody("MyProj", null);
    expect(b).toContain("MyProj");
    expect(b).not.toContain('""');
  });
});
