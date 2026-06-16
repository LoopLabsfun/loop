"use client";

// Privy authentication for Loop's users. Env-gated: when NEXT_PUBLIC_PRIVY_APP_ID
// is unset the provider is a pass-through, so the app (and SSR/build) work
// without Privy configured — the same fail-open pattern as the rest of the seam.
// Distinct from lib/agent-wallet.ts, which is the SERVER-side custody of each
// project's *agent* wallet (same Privy app, REST API). This is the *user* login.
//
// Login methods (configured to match the Privy dashboard): Google, Twitter/X,
// GitHub, Telegram socials + Solana external wallets, with an embedded Solana
// wallet created on login for users who arrive via a social.

import { PrivyProvider } from "@privy-io/react-auth";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function PrivyAuthProvider({ children }: { children: React.ReactNode }) {
  // Fail open: no app id → render children directly (the stub wallet still works).
  if (!APP_ID) return <>{children}</>;

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ["google", "twitter", "github", "telegram", "wallet"],
        appearance: {
          walletChainType: "solana-only",
          // Socials first — Loop leans on social login, wallet is also offered.
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
