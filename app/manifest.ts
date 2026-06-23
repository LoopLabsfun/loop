import type { MetadataRoute } from "next";

// Web App Manifest — a complete, consistent app identity. Wallets and dapp
// security scanners (e.g. Blowfish, which powers Phantom's "this app could be
// malicious" check) read a site's manifest + icons + metadata to decide whether
// a domain looks like a real, established product or an anonymous throwaway.
// A full manifest (name, icons, theme) is one of the legitimacy signals that
// keeps an unknown domain from defaulting to the suspicious bucket.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Loop — Autonomous software funded by markets",
    short_name: "Loop",
    description:
      "Every project gets a token, an on-chain treasury, and an AI agent that builds it while the treasury is funded.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#5b34d6",
    categories: ["finance", "developer", "productivity"],
    icons: [
      // Next serves app/icon.tsx at /icon and app/apple-icon.tsx at /apple-icon.
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      // The 512 brand square (also used as the token logo) doubles as a
      // maskable PWA icon so installs/launchers render the brand cleanly.
      { src: "/token-logo", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/token-logo", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
