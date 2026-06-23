import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// OAuth 1.0a request signing (HMAC-SHA1), per RFC 5849 — the auth scheme the X
// API v2 accepts for user-context writes. Pure + dependency-free so it can be
// unit-tested against X's official example vector and reused by both the send
// path (lib/x-send.ts) and the PIN-auth helper (scripts/x-auth.ts) without the
// `server-only` guard. No I/O.
// ─────────────────────────────────────────────────────────────────────────────

export interface OAuth1Creds {
  consumerKey: string;
  consumerSecret: string;
  /** User access token (empty for the request_token step). */
  token: string;
  /** User access token secret (empty for the request_token step). */
  tokenSecret: string;
}

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
export function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * Build the OAuth 1.0a `Authorization` header for a signed request. `extra`
 * holds any form/query params to sign (none for a JSON-body POST /2/tweets, but
 * required for the auth endpoints, which send form params). `nonce`/`ts` are
 * injectable so the signature is deterministic in tests. An empty `token` omits
 * `oauth_token` (the request_token step).
 */
export function oauth1Header(
  method: string,
  url: string,
  creds: OAuth1Creds,
  extra: Record<string, string> = {},
  nonce = crypto.randomBytes(16).toString("hex"),
  ts = Math.floor(Date.now() / 1000).toString()
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: ts,
    oauth_version: "1.0",
  };
  if (creds.token) oauth.oauth_token = creds.token;

  // Signature base string: METHOD&url&sortedParams (oauth + extra), all encoded.
  const all: Record<string, string> = { ...oauth, ...extra };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(all[k])}`)
    .join("&");
  const base = [method.toUpperCase(), pctEncode(url), pctEncode(paramString)].join(
    "&"
  );
  const signingKey = `${pctEncode(creds.consumerSecret)}&${pctEncode(creds.tokenSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(base)
    .digest("base64");

  // The Authorization header carries the oauth_* params (incl. any oauth_* in
  // `extra`, e.g. oauth_callback / oauth_verifier on the auth endpoints) +
  // the signature. Non-oauth form/query params are signed but NOT in the header.
  const header: Record<string, string> = { ...oauth, oauth_signature: signature };
  for (const k of Object.keys(extra)) {
    if (k.startsWith("oauth_")) header[k] = extra[k];
  }
  return (
    "OAuth " +
    Object.keys(header)
      .sort()
      .map((k) => `${pctEncode(k)}="${pctEncode(header[k])}"`)
      .join(", ")
  );
}
