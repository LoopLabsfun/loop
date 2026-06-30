import "server-only";
import { SITE_URL } from "./site";

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT TEMPLATE BRANDING — the files committed into a project's freshly
// generated repo (LoopLabsfun/<key>, from GITHUB_TEMPLATE_REPO) at WHITELIST
// time, before the agent ever touches it. The bare template is intentionally
// minimal (unstyled, "🚀 Building autonomously on Loop"); this swaps in the
// project's own identity — name, ticker, description, token image — in Loop's
// own palette, so the FIRST deploy already looks like a real product instead
// of a generic Next.js starter.
//
// Pure string generation only (no I/O) — lib/provisioning-exec.ts pushes these
// via the GitHub Contents API. Reuses the exact hex palette already used in
// app/opengraph-image.tsx + app/token-og/route.tsx for visual consistency.
// ─────────────────────────────────────────────────────────────────────────────

const CANVAS = "#fcfcfd";
const INK = "#16131a";
const ACCENT = "#5b34d6";
const MUTED = "#6b6675";
const FAINT = "#9b95a4";
const LINE = "#e7e3ee";

export interface ProjectBrand {
  key: string;
  name: string;
  ticker: string;
  description: string;
  tokenImageUrl?: string | null;
}

/** The token page on Loop — every generated home links back here. */
export function loopTokenUrl(key: string): string {
  return `${SITE_URL}/token?p=${key}`;
}

/** The dynamic share-card image already live for every project's /token page —
 *  reused as-is rather than generating a second OG image per repo: one
 *  canonical renderer, consistent everywhere, improves for every project at
 *  once if it's ever improved. */
export function loopOgImageUrl(key: string): string {
  return `${SITE_URL}/token-og?p=${key}`;
}

/** app/layout.jsx — metadata (title/description/OG) driven by the project's
 *  real identity, pointed at the shared dynamic OG image. */
export function brandedLayoutJsx(b: ProjectBrand): string {
  const title = `${b.name} (${b.ticker})`;
  const desc = (b.description || `Built autonomously by its AI agent on Loop.`).slice(0, 300);
  const og = loopOgImageUrl(b.key);
  return [
    `export const metadata = {`,
    `  title: ${JSON.stringify(title)},`,
    `  description: ${JSON.stringify(desc)},`,
    `  openGraph: {`,
    `    title: ${JSON.stringify(title)},`,
    `    description: ${JSON.stringify(desc)},`,
    `    images: [${JSON.stringify(og)}],`,
    `  },`,
    `  twitter: { card: "summary_large_image", images: [${JSON.stringify(og)}] },`,
    `};`,
    ``,
    `export default function RootLayout({ children }) {`,
    `  return (`,
    `    <html lang="en">`,
    `      <head>`,
    `        <link rel="preconnect" href="https://fonts.googleapis.com" />`,
    `        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />`,
    `      </head>`,
    `      <body style={{ margin: 0, background: ${JSON.stringify(CANVAS)}, color: ${JSON.stringify(INK)}, fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>`,
    `        {children}`,
    `      </body>`,
    `    </html>`,
    `  );`,
    `}`,
    ``,
  ].join("\n");
}

/** app/page.jsx — a branded "the agent is building" landing page: logo (if
 *  uploaded), name + ticker, the pitch, and a link back to the project's Loop
 *  token page. Replaced wholesale once the agent starts shipping real pages. */
export function brandedPageJsx(b: ProjectBrand): string {
  const desc = (b.description || `This project is built, shipped and funded by its own AI agent.`).slice(0, 280);
  const tokenUrl = loopTokenUrl(b.key);
  const logo = b.tokenImageUrl
    ? [
        `      <img`,
        `        src={${JSON.stringify(b.tokenImageUrl)}}`,
        `        alt=""`,
        `        width={72}`,
        `        height={72}`,
        `        style={{ borderRadius: 20, objectFit: "cover", border: "1px solid ${LINE}" }}`,
        `      />`,
      ].join("\n")
    : "";
  return [
    `export default function Page() {`,
    `  return (`,
    `    <main`,
    `      style={{`,
    `        minHeight: "100dvh",`,
    `        display: "flex",`,
    `        flexDirection: "column",`,
    `        alignItems: "center",`,
    `        justifyContent: "center",`,
    `        textAlign: "center",`,
    `        padding: "4rem 1.5rem",`,
    `        gap: "1.1rem",`,
    `      }}`,
    `    >`,
    logo,
    `      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>`,
    `        <h1 style={{ fontSize: "2.6rem", margin: 0, letterSpacing: "-0.03em", fontWeight: 700 }}>${b.name}</h1>`,
    `        <span style={{ fontSize: "1.1rem", color: ${JSON.stringify(ACCENT)}, fontWeight: 600 }}>$${b.ticker}</span>`,
    `      </div>`,
    `      <p style={{ color: ${JSON.stringify(MUTED)}, maxWidth: 560, lineHeight: 1.6, fontSize: "1.05rem" }}>`,
    `        ${desc}`,
    `      </p>`,
    `      <a`,
    `        href={${JSON.stringify(tokenUrl)}}`,
    `        style={{`,
    `          marginTop: "0.5rem",`,
    `          display: "inline-flex",`,
    `          alignItems: "center",`,
    `          gap: 8,`,
    `          padding: "10px 18px",`,
    `          borderRadius: 999,`,
    `          background: ${JSON.stringify(INK)},`,
    `          color: ${JSON.stringify(CANVAS)},`,
    `          fontSize: "0.95rem",`,
    `          fontWeight: 600,`,
    `          textDecoration: "none",`,
    `        }}`,
    `      >`,
    `        Built autonomously by its AI agent on Loop →`,
    `      </a>`,
    `      <p style={{ color: ${JSON.stringify(FAINT)}, fontSize: "0.85rem", marginTop: "2rem" }}>`,
    `        This page will change as the agent builds — check back soon.`,
    `      </p>`,
    `    </main>`,
    `  );`,
    `}`,
    ``,
  ].join("\n");
}
