import { describe, expect, it } from "vitest";
import { oauth1Header } from "./x-send";

// X's own documented OAuth 1.0a worked example ("Creating a signature"). With
// these exact inputs the signature MUST be hCtSmYh+iHYCEqBWrE7C7hYmtUk= — if our
// base-string assembly or percent-encoding drifts, this catches it before it
// turns into opaque 401s against the live API.
const VECTOR = {
  method: "POST",
  url: "https://api.twitter.com/1.1/statuses/update.json",
  consumerKey: "xvz1evFS4wEEPTGEFPHBog",
  consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
  token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
  ts: "1318622958",
  // Body/query params that participate in the signature.
  extra: {
    status: "Hello Ladies + Gentlemen, a signed OAuth request!",
    include_entities: "true",
  },
  // From X's docs. In the header it is percent-encoded (+ → %2B, = → %3D).
  expectedSignature: "hCtSmYh+iHYCEqBWrE7C7hYmtUk=",
};

/** Pull the oauth_signature value out of an Authorization header + URL-decode it. */
function signatureFrom(header: string): string {
  const m = header.match(/oauth_signature="([^"]+)"/);
  if (!m) throw new Error("no oauth_signature in header");
  return decodeURIComponent(m[1]);
}

describe("oauth1Header", () => {
  it("reproduces X's documented signature vector", () => {
    const header = oauth1Header(
      VECTOR.method,
      VECTOR.url,
      {
        consumerKey: VECTOR.consumerKey,
        consumerSecret: VECTOR.consumerSecret,
        token: VECTOR.token,
        tokenSecret: VECTOR.tokenSecret,
      },
      VECTOR.extra,
      VECTOR.nonce,
      VECTOR.ts
    );
    expect(signatureFrom(header)).toBe(VECTOR.expectedSignature);
  });

  it("starts with the OAuth scheme and carries the standard fields", () => {
    const header = oauth1Header(
      "POST",
      "https://api.twitter.com/2/tweets",
      {
        consumerKey: "ck",
        consumerSecret: "cs",
        token: "tk",
        tokenSecret: "ts",
      },
      {},
      "nonce123",
      "1700000000"
    );
    expect(header.startsWith("OAuth ")).toBe(true);
    expect(header).toContain('oauth_consumer_key="ck"');
    expect(header).toContain('oauth_token="tk"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_version="1.0"');
  });

  it("omits oauth_token when the token is empty (request_token step)", () => {
    const header = oauth1Header(
      "POST",
      "https://api.twitter.com/oauth/request_token",
      { consumerKey: "ck", consumerSecret: "cs", token: "", tokenSecret: "" },
      { oauth_callback: "oob" },
      "nonce123",
      "1700000000"
    );
    expect(header).not.toContain("oauth_token=");
    expect(header).toContain("oauth_signature=");
  });
});
