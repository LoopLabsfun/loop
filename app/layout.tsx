import type { Metadata, Viewport } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { WalletProvider } from "@/lib/wallet";
import { NetworkProvider } from "@/lib/network";
import { ChainProvider } from "@/lib/chains/chain-context";
import { PrivyAuthProvider } from "@/lib/privy";
import { SessionSync } from "@/components/SessionSync";
import { SITE_URL } from "@/lib/site";
import { EXTERNAL_LINKS } from "@/lib/links";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

// A complete, consistent site identity (canonical name + icons + manifest +
// canonical URL + indexable robots) is what a dapp security scanner like
// Blowfish (Phantom's "this app could be malicious" provider) reads to tell a
// real, established product apart from an anonymous throwaway domain. Every field
// below is a legitimacy signal that helps keep the connect/sign prompt from
// defaulting to the suspicious bucket.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "Loop",
  title: {
    default: "Loop — Autonomous software funded by markets",
    template: "%s · Loop",
  },
  description:
    "Every project gets a token, an on-chain treasury, and an AI agent. Trading activity fills the treasury. The agent builds while the wallet is funded.",
  keywords: [
    "Loop",
    "Solana",
    "autonomous software",
    "AI agent",
    "launchpad",
    "pump.fun",
    "on-chain treasury",
    "$LOOP",
  ],
  authors: [{ name: "Loop Labs" }],
  creator: "Loop Labs",
  publisher: "Loop Labs",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  // Explicit icon set (Next also auto-wires app/icon.tsx + app/apple-icon.tsx,
  // but declaring them makes the identity unambiguous to crawlers/wallets).
  icons: {
    icon: "/icon",
    apple: "/apple-icon",
  },
  openGraph: {
    title: "Loop — The first autonomous software factory",
    description: "Launch a token. Fund an AI. Build forever.",
    url: "/",
    type: "website",
    siteName: "Loop",
  },
  twitter: {
    card: "summary_large_image",
    title: "Loop — The first autonomous software factory",
    description: "Launch a token. Fund an AI. Build forever.",
    creator: "@looplabsfun",
    site: "@looplabsfun",
  },
};

export const viewport: Viewport = {
  themeColor: "#5b34d6",
  colorScheme: "light",
};

// schema.org Organization + WebSite structured data (JSON-LD) — another
// legitimacy signal alongside the metadata above, read by search crawlers and
// some dapp-reputation tooling: a real entity with a name, a described
// purpose, and verifiable social/code presence (sameAs), not an anonymous
// page. Sourced from the SAME registries as the rest of the site (SITE_URL,
// EXTERNAL_LINKS) so it can never drift out of sync with the real links.
//
// Important, and worth being honest about: this does NOT by itself clear a
// Phantom/Blowfish "could be malicious" new-domain warning — Blowfish's
// dapp-allowlist is a manual review process (GitHub repo + socials submitted,
// human-verified), not something a meta tag or JSON-LD block can bypass. This
// is a real, additional legitimacy signal; the actual fix for the warning is
// submitting looplabs.fun for review (see docs, "Blowfish verification").
function StructuredData() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "Loop",
        url: SITE_URL,
        logo: `${SITE_URL}/icon`,
        sameAs: EXTERNAL_LINKS.map((l) => l.href),
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "Loop",
        description:
          "Every project gets a token, an on-chain treasury, and an AI agent. Trading activity fills the treasury. The agent builds while the wallet is funded.",
        publisher: { "@id": `${SITE_URL}/#organization` },
        inLanguage: "en",
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="font-sans text-ink bg-canvas min-h-screen">
        <StructuredData />
        <ChainProvider>
          <NetworkProvider>
            <PrivyAuthProvider>
              <WalletProvider>
                <SessionSync />
                {children}
              </WalletProvider>
            </PrivyAuthProvider>
          </NetworkProvider>
        </ChainProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
