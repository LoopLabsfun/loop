"use client";

import { useEffect } from "react";
import { useWallet } from "@/lib/wallet";
import { apiClearSession, apiSessionWallet, sessionWallet } from "@/lib/social-client";

// Keeps the signed user session in lock-step with the connected wallet. The
// session cookie lives 7 days and is httpOnly, so switching wallets in the same
// browser would otherwise leave a STALE session that acts as the previous wallet
// — which silently wrote one wallet's avatar onto another's profile and made
// follow/DM act as (and fail for) the wrong wallet. When the connected address
// no longer matches the wallet the session was minted for, we clear it; the next
// social action re-establishes one for the wallet you're actually connected as.
//
// We confirm against the SERVER (apiSessionWallet) rather than trusting the
// localStorage hint alone: a session minted before that hint existed (or after
// localStorage was cleared) would otherwise go undetected and keep acting as the
// old wallet.
//
// It only ever acts while a SOLANA wallet is connected. A session opened from
// the EVM side resolves to a Solana wallet the user may not have connected here
// at all — checking "cookie wallet ≠ connected wallet" in that state would clear
// a perfectly good session on every render and lock the user out of their own
// DMs. No connected Solana wallet ⇒ nothing to contradict, so nothing to do.
// Renders nothing.
export function SessionSync() {
  const wallet = useWallet();
  useEffect(() => {
    if (!wallet.connected || !wallet.address) return;
    const connected = wallet.address;
    // Fast path: the local hint already shows a mismatch.
    const hint = sessionWallet();
    if (hint && hint !== connected) {
      apiClearSession();
      return;
    }
    // Source of truth: ask the server which wallet the cookie is actually for.
    let cancelled = false;
    apiSessionWallet().then((owner) => {
      if (!cancelled && owner && owner !== connected) apiClearSession();
    });
    return () => {
      cancelled = true;
    };
  }, [wallet.connected, wallet.address]);
  return null;
}
