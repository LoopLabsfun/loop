"use client";

import { useEffect } from "react";
import { useWallet } from "@/lib/wallet";
import { apiClearSession, sessionWallet } from "@/lib/social-client";

// Keeps the signed user session in lock-step with the connected wallet. The
// session cookie lives 7 days and is httpOnly, so switching wallets in the same
// browser would otherwise leave a STALE session that acts as the previous wallet
// — which silently wrote one wallet's avatar onto another's profile. When the
// connected address no longer matches the wallet the session was minted for, we
// clear the session; the next social action re-establishes one for the wallet
// you're actually connected as. Renders nothing.
export function SessionSync() {
  const wallet = useWallet();
  useEffect(() => {
    if (!wallet.connected || !wallet.address) return;
    const owner = sessionWallet();
    if (owner && owner !== wallet.address) {
      apiClearSession();
    }
  }, [wallet.connected, wallet.address]);
  return null;
}
