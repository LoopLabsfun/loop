/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The @solana/* packages (web3.js + the wallet adapters) are ESM-only.
  // lib/wallet.tsx is a Client Component, but the root layout SSRs it, so the
  // server bundle pulls these in. Externalizing them (the old
  // serverComponentsExternalPackages approach) makes the Vercel lambda
  // require() an ESM file → ERR_REQUIRE_ESM, 500-ing every SSR'd page.
  // transpilePackages bundles + transpiles them instead, so they load on the
  // server path without the require() trap while SSR keeps working.
  transpilePackages: [
    "@solana/web3.js",
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-wallets",
  ],
  // Baseline security headers on every response (defense-in-depth before going
  // public). Deliberately NO Content-Security-Policy: a strict CSP on this
  // Privy + wallet-adapter + Next app (inline bootstrap scripts, third-party
  // wallet frames) is high-risk to add un-tested and would break the live site —
  // tracked as a follow-up to roll out in report-only mode first. These five are
  // behaviour-neutral:
  //   • nosniff            — stop MIME-sniffing a response into a script
  //   • X-Frame-Options    — clickjacking: our pages can't be framed by others
  //   • Referrer-Policy    — don't leak full URLs/keys to cross-origin referers
  //   • Permissions-Policy — deny APIs we never use (camera/mic/geo + Topics)
  //   • HSTS               — pin HTTPS (explicit; also covers the custom domain)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    // Privy declares several integrations as OPTIONAL peer deps (Abstract Global
    // Wallet, Stripe crypto on-ramp, ERC-4337 `permissionless`). We install with
    // legacy-peer-deps (an `ox` version clash with the wallet-adapter stack), so
    // these optional peers aren't pulled in — but Privy's bundle still statically
    // imports them. Loop uses none of these features, so stub them to empty
    // modules instead of failing the build on the missing packages.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@abstract-foundation/agw-client": false,
      "@stripe/crypto": false,
      permissionless: false,
    };
    return config;
  },
};

export default nextConfig;
