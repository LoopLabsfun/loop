import { describe, it, expect } from "vitest";
import { issueUserToken, verifyUserToken, isStaleSession } from "./user-session";

// Two real base58 Solana addresses (44 chars).
const A = "H8UMZSW2nZQm59G56UGmKAKVcgf5rcgEdFbVvcA9TSvC";
const B = "8p8VtLJ5PkUNYR3ih3ykw9797572vKeFBaKYgAZr3Q5t";
const KEY = "test-user-session-secret-0123456789";

describe("issueUserToken / verifyUserToken", () => {
  const now = 1_700_000_000_000;

  it("round-trips a freshly minted token to its claims", () => {
    const tok = issueUserToken(A, { now, key: KEY });
    expect(tok).toBeTruthy();
    const claims = verifyUserToken(tok, { now, key: KEY });
    expect(claims?.wallet).toBe(A);
    expect(claims?.exp).toBeGreaterThan(now);
  });

  it("returns null when no server secret is configured", () => {
    expect(issueUserToken(A, { now, key: "" })).toBeNull();
    // …and a token can't be verified without a key either.
    const tok = issueUserToken(A, { now, key: KEY })!;
    expect(verifyUserToken(tok, { now, key: "" })).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const tok = issueUserToken(A, { now, key: KEY })!;
    expect(verifyUserToken(tok, { now, key: "other-secret" })).toBeNull();
  });

  it("rejects a tampered MAC", () => {
    const tok = issueUserToken(A, { now, key: KEY })!;
    expect(verifyUserToken(tok.slice(0, -1) + (tok.endsWith("x") ? "y" : "x"), { now, key: KEY })).toBeNull();
  });

  it("rejects a tampered payload (forged wallet)", () => {
    const tok = issueUserToken(A, { now, key: KEY })!;
    const forged = Buffer.from(`${B}:${now + 1000}`).toString("base64url") + "." + tok.slice(tok.indexOf(".") + 1);
    expect(verifyUserToken(forged, { now, key: KEY })).toBeNull();
  });

  it("rejects an expired token", () => {
    const tok = issueUserToken(A, { now, ttlMs: 1000, key: KEY })!;
    expect(verifyUserToken(tok, { now: now + 2000, key: KEY })).toBeNull();
    // …but is valid before expiry.
    expect(verifyUserToken(tok, { now: now + 500, key: KEY })?.wallet).toBe(A);
  });

  it("rejects malformed/empty tokens", () => {
    for (const t of [undefined, null, "", "no-dot", ".onlymac", "a.b.c"]) {
      expect(verifyUserToken(t as string | undefined | null, { now, key: KEY })).toBeNull();
    }
  });
});

describe("isStaleSession", () => {
  it("is false when there is no session at all (the 401 path handles it)", () => {
    expect(isStaleSession(null, B)).toBe(false);
    expect(isStaleSession(undefined, B)).toBe(false);
    expect(isStaleSession("", B)).toBe(false);
  });

  it("is false when the claimed actor matches the session wallet", () => {
    expect(isStaleSession(A, A)).toBe(false);
  });

  it("is TRUE when the connected wallet differs from the session cookie", () => {
    expect(isStaleSession(A, B)).toBe(true);
  });

  it("is false for a missing or malformed actor hint (the hint never tightens auth alone)", () => {
    for (const junk of [undefined, null, "", "   ", "not-a-wallet", "0OIl-invalid", "x".repeat(60)]) {
      expect(isStaleSession(A, junk as string | null | undefined)).toBe(false);
    }
  });

  it("trims whitespace around an otherwise-valid hint", () => {
    expect(isStaleSession(A, `  ${A}  `)).toBe(false); // same wallet, padded
    expect(isStaleSession(A, `  ${B}  `)).toBe(true); // different wallet, padded
  });
});
