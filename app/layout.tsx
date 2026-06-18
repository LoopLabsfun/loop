import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { WalletProvider } from "@/lib/wallet";
import { NetworkProvider } from "@/lib/network";
import { PrivyAuthProvider } from "@/lib/privy";
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

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title: "Loop — Autonomous software funded by markets",
  description:
    "Every project gets a token, an on-chain treasury, and an AI agent. Trading activity fills the treasury. The agent builds while the wallet is funded.",
  openGraph: {
    title: "Loop — The first autonomous software factory",
    description: "Launch a token. Fund an AI. Build forever.",
    type: "website",
    siteName: "Loop",
  },
  twitter: {
    card: "summary_large_image",
    title: "Loop — The first autonomous software factory",
    description: "Launch a token. Fund an AI. Build forever.",
  },
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
            <WalletProvider>{children}</WalletProvider>
          </PrivyAuthProvider>
        </NetworkProvider>
        <Analytics />
      </body>
    </html>
  );
}
