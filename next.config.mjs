/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // @solana/web3.js is a CJS/ESM hybrid that fails Next's vendor-chunking
    // inside route handlers. Mark it external so it's required at runtime.
    serverComponentsExternalPackages: ["@solana/web3.js"],
  },
};

export default nextConfig;
