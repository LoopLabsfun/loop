import type { Metadata, Viewport } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { WalletProvider } from "@/lib/wallet";
import { NetworkProvider } from "@/lib/network";
import { PrivyAuthProvider } from "@/lib/privy";
import { SessionSync } from "@/components/SessionSync";
import { SITE_URL } from "@/lib/site";
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="font-sans text-ink bg-canvas min-h-screen">
        <NetworkProvider>
          <PrivyAuthProvider>
            <WalletProvider>
              <SessionSync />
              {children}
            </WalletProvider>
          </PrivyAuthProvider>
        </NetworkProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
