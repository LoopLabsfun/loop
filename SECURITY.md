# Security Policy

loop.fun runs a real, market-funded autonomous agent that ships code to this
repository in public. We take the integrity of that loop — and the safety of the
projects and holders that depend on it — seriously, and we welcome responsible
disclosure.

## Reporting a vulnerability

**Please do not open a public issue for security reports.** Use either channel:

- **GitHub private vulnerability reporting** — the **"Report a vulnerability"**
  button under this repository's **Security** tab. Preferred: it keeps the report
  private until a fix ships.
- **Email** — `contact@looplabs.fun`. PGP available on request.

Please include enough to reproduce: the affected URL/endpoint or file, steps,
expected vs. actual impact, and any proof-of-concept. We aim to **acknowledge
within 72 hours** and to keep you updated through triage and remediation.

## Scope

**In scope**

- The web app and its API routes.
- The autonomous agent runtime and its on-chain action paths.
- The launch / treasury flows and the authorization of any state-changing
  endpoint.

**Out of scope**

- Volumetric / denial-of-service attacks.
- Findings that only affect simulated or demo data.
- Vulnerabilities in third-party providers we integrate with (report those to the
  provider).
- Social engineering of the team or token holders.

## What we already do

- **No secrets in the repo.** The server holds them; the browser never receives a
  server-only key. `.env*.local` and all keypairs are gitignored, and the history
  has been audited.
- **Fail-closed auth.** Every state-changing endpoint authenticates and rejects
  when its secret is unset or wrong.
- **The treasury is sacred.** The agent has no ability to transfer treasury funds
  to an arbitrary wallet — irreversible or out-of-mandate actions escalate to a
  human, by construction, not just by prompt.
- **Public steering is untrusted input.** Directives and holder messages are
  treated as data, never as commands.

## Wallet trust & dapp-scanner posture (Phantom / Blowfish)

Phantom routes connect/sign prompts through Blowfish, which warns "this app could
be malicious" for domains it doesn't yet recognise. The warning is a
*reputation/identity* signal, not a finding about our transactions — every
transaction we build is a plain, legible operation (`SystemProgram.transfer`, an
SPL `transfer`, or a pump.fun swap built by PumpPortal). We never request
`setAuthority`, unlimited approvals, or account-closing sweeps, and the agent
cannot move treasury funds to an arbitrary wallet.

To present as a legitimate, established dapp (so scanners don't default us to the
suspicious bucket), the site ships a complete identity: a Web App Manifest
(`app/manifest.ts`), a full icon set (`app/icon.tsx`, `app/apple-icon.tsx`, the
512² `app/token-logo`), canonical URL + indexable `robots`/`sitemap`, OpenGraph/
Twitter cards, security headers, and consistent `applicationName`/`themeColor`
metadata.

**Operational requirements (founder, outside code):**
1. **Connect from the custom domain** (`looplabs.fun`), never a `*.vercel.app`
   URL — preview/anonymous Vercel domains are flagged aggressively. Set
   `NEXT_PUBLIC_SITE_URL` to the apex and serve the dapp there.
2. **Register the domain with Blowfish** for review/allowlisting
   (<https://blowfish.xyz>) — this is the definitive un-flag once the identity
   above is in place. Only after the code signals are live.

## Coordinated disclosure

We'll agree a disclosure timeline with you and credit you (if you wish) once a fix
is deployed. Please give us a reasonable window to remediate before any public
write-up. Thank you for helping keep Loop and its holders safe.
