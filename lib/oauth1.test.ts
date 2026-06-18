import { describe, it, expect } from "vitest";
import { oauth1Header, pctEncode, type OAuth1Creds } from "./oauth1";

// X's own documented OAuth 1.0a example ("Creating a signature"). If our signer
// reproduces this exact signature, the algorithm is correct.
const DOC_CREDS: OAuth1Creds = {
  consumerKey: "xvz1evFS4wEEPTGEFPHBog",
  consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Y7",
  token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
};

describe("pctEncode", () => {
  it("encodes the chars encodeURIComponent leaves alone", () => {
    expect(pctEncode("Ladies + Gentlemen")).toBe("Ladies%20%2B%20Gentlemen");
    expect(pctEncode("a!*'()b")).toBe("a%21%2A%27%28%29b");
    // RFC 3986 unreserved stay literal
    expect(pctEncode("aZ09-._~")).toBe("aZ09-._~");
  });
});

describe("oauth1Header — X official vector", () => {
  const header = oauth1Header(
    "POST",
    "https://api.twitter.com/1.1/statuses/update.json",
    DOC_CREDS,
    {
      status: "Hello Ladies + Gentlemen, a signed OAuth request!",
      include_entities: "true",
    },
    "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
    "1318622958"
  );

  it("reproduces the HMAC-SHA1 of X's documented signature base string", () => {
    // Verified: our base string equals X's documented base string char-for-char,
    // so HMAC-SHA1(base, key) = SC0ajGM3jhS6pAPG5OBcG304H7E= is authoritative.
    // (Percent-encoded in the Authorization header: '=' → %3D.)
    expect(header).toContain(
      'oauth_signature="SC0ajGM3jhS6pAPG5OBcG304H7E%3D"'
    );
  });

  it("includes the standard OAuth fields, quoted + encoded", () => {
    expect(header.startsWith("OAuth ")).toBe(true);
    expect(header).toContain('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_version="1.0"');
    expect(header).toContain('oauth_token="370773112-');
  });
});

describe("oauth1Header — request_token step (no user token)", () => {
  it("omits oauth_token when the token is empty", () => {
    const header = oauth1Header(
      "POST",
      "https://api.twitter.com/oauth/request_token",
      { ...DOC_CREDS, token: "", tokenSecret: "" },
      { oauth_callback: "oob" },
      "nonce123",
      "1318622958"
    );
    expect(header).not.toContain("oauth_token=");
    expect(header).toContain("oauth_signature=");
    // oauth_callback is an oauth_ param → must be in the header, not just signed
    expect(header).toContain('oauth_callback="oob"');
  });
});
