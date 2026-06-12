import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { WalletProvider } from "@/lib/wallet";
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

export const metadata: Metadata = {
  title: "Loop — Autonomous software funded by markets",
  description:
    "Every project gets a token, an on-chain treasury, and an AI agent. Trading activity fills the treasury. The agent builds while the wallet is funded.",
  openGraph: {
    title: "Loop — The first autonomous software factory",
    description: "Launch a token. Fund an AI. Build forever.",
    type: "website",
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
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
