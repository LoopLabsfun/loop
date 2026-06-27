import { describe, it, expect } from "vitest";
import { normalizeEmail, normalizeXHandle, validateWaitlist, welcomeDmBody, IDEA_MAX } from "./waitlist";

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

describe("validateWaitlist", () => {
  it("requires at least one contact (wallet, email, or X)", () => {
    const r = validateWaitlist({ idea: "build me a thing" });
    expect(r.clean).toBeUndefined();
    expect(r.error).toMatch(/reach you/i);
  });

  it("accepts a wallet-only signup", () => {
    const r = validateWaitlist({ wallet: WALLET });
    expect(r.error).toBeUndefined();
    expect(r.clean?.wallet).toBe(WALLET);
    expect(r.clean?.email).toBeNull();
  });

  it("accepts an email-only signup and normalizes it", () => {
    expect(validateWaitlist({ email: " A@B.com " }).clean?.email).toBe("a@b.com");
  });

  it("drops an invalid email but still succeeds when another contact is present", () => {
    const r = validateWaitlist({ wallet: WALLET, email: "not-an-email" });
    expect(r.clean?.wallet).toBe(WALLET);
    expect(r.clean?.email).toBeNull();
  });

  it("caps the idea to IDEA_MAX and trims", () => {
    const r = validateWaitlist({ xHandle: "@me", idea: " " + "x".repeat(IDEA_MAX + 50) + " " });
    expect(r.clean?.idea?.length).toBe(IDEA_MAX);
  });

  it("normalizes a referrer (wallet or X handle)", () => {
    expect(validateWaitlist({ email: "a@b.com", referrer: "@ref" }).clean?.referrer).toBe("ref");
    expect(validateWaitlist({ email: "a@b.com", referrer: WALLET }).clean?.referrer).toBe(WALLET);
    expect(validateWaitlist({ email: "a@b.com", referrer: "!!" }).clean?.referrer).toBeNull();
  });
});

describe("welcomeDmBody", () => {
  it("echoes the idea back when present", () => {
    const b = welcomeDmBody("a tip jar for streamers");
    expect(b).toContain("a tip jar for streamers");
    expect(b).toMatch(/launch waitlist/i);
  });
  it("falls back to a generic ask when there's no idea", () => {
    const b = welcomeDmBody(null);
    expect(b).toMatch(/what do you want to build/i);
    expect(b).not.toContain('""');
  });
});
