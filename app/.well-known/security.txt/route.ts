import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

// RFC 9116 security.txt, served at the well-known path `/.well-known/security.txt`.
// Two reasons it lives here:
//   1. It gives security researchers a clear, monitored disclosure channel.
//   2. It's one of the standard "responsible operator" signals that wallet / dapp
//      reputation scanners (Phantom / Blowfish) and crawlers read when deciding
//      whether a fresh domain is a real product vs. a throwaway phishing page —
//      part of clearing the new-domain "could be malicious" warning.
//
// `Expires` (required by RFC 9116) is computed ~6 months out on every request so
// the file never goes stale.
export function GET() {
  const expires = new Date(
    Date.now() + 183 * 24 * 60 * 60 * 1000
  ).toISOString();

  const body =
    [
      "# Loop — security contact (RFC 9116)",
      "Contact: https://github.com/LoopLabsfun/loop/security/advisories/new",
      "Contact: https://x.com/looplabsfun",
      `Expires: ${expires}`,
      "Preferred-Languages: en, fr",
      `Canonical: ${SITE_URL}/.well-known/security.txt`,
      "Policy: https://github.com/LoopLabsfun/loop/blob/main/SECURITY.md",
      "",
    ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
