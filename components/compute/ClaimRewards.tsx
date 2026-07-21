"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";

// Self-serve claim of earned compute rewards. Pull, not push: the server
// returns a partially-signed transaction whose FEE PAYER is the user's wallet,
// so the claimer pays the network fee and their own $LOOP token-account rent
// (~0.002 SOL, once) — the treasury only co-signs the token transfer. Rewards
// are paid in $LOOP on Solana; a linked Hood address is stored for when $LOOP
// is live on Hood, nothing pays out there yet.

interface Quote {
  ok: boolean;
  claimableLoop: number;
  pendingLoop: number;
  note: string;
}

const QUOTE_POLL_MS = 60_000;

export function ClaimRewards() {
  const wallet = useWallet();
  const [token, setToken] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastClaim, setLastClaim] = useState<{ loop: number; sig: string } | null>(null);

  // The device token minted at enrollment is the claim credential — same
  // localStorage slot BrowserNode uses, so an enrolled device can claim even
  // in a later session without re-signing.
  useEffect(() => {
    const address = wallet.address;
    if (!address || typeof window === "undefined") {
      setToken(null);
      return;
    }
    setToken(window.localStorage.getItem(`loop-compute-token:${address}`));
  }, [wallet.address]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/compute/claim", { headers: { "x-device-token": token } });
      if (res.ok) setQuote((await res.json()) as Quote);
    } catch {
      // transient — keep the last quote
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setQuote(null);
      return;
    }
    void refresh();
    const t = setInterval(() => void refresh(), QUOTE_POLL_MS);
    return () => clearInterval(t);
  }, [token, refresh]);

  const claim = useCallback(async () => {
    if (!token || claiming) return;
    setError(null);
    setClaiming(true);
    try {
      const buildRes = await fetch("/api/compute/claim", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-token": token },
        body: JSON.stringify({}),
      });
      const built = (await buildRes.json()) as { ok: boolean; txBase64?: string; claimLoop?: number; note: string };
      if (!built.ok || !built.txBase64) throw new Error(built.note || "claim build failed");
      const bytes = Uint8Array.from(atob(built.txBase64), (c) => c.charCodeAt(0));
      // The wallet signs as fee payer and broadcasts — this is where the user
      // pays their own rent.
      const sig = await wallet.sendSwapTx(bytes);
      const confirmRes = await fetch("/api/compute/claim", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-token": token },
        body: JSON.stringify({ signature: sig }),
      });
      const confirmed = (await confirmRes.json()) as { ok: boolean; claimedLoop?: number; note: string };
      if (!confirmed.ok) throw new Error(confirmed.note || "confirm failed");
      setLastClaim({ loop: confirmed.claimedLoop ?? built.claimLoop ?? 0, sig });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "claim failed");
      // The tx may have landed even if confirm errored — a refresh reconciles.
      void refresh();
    } finally {
      setClaiming(false);
    }
  }, [token, claiming, wallet, refresh]);

  // No wallet or never enrolled → nothing to claim, stay out of the way.
  if (!wallet.connected || !token) return null;

  const claimable = quote?.claimableLoop ?? 0;
  const open = quote?.ok !== false;

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] px-5 py-[18px] mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="font-display font-semibold text-[15px]">Your rewards</div>
        <span className="font-mono text-[12.5px] text-ink">
          {claimable > 0 ? `${claimable.toLocaleString("en-US")} $LOOP` : "0 $LOOP"}
          <span className="text-faint"> claimable</span>
        </span>
      </div>
      <p className="text-[12.5px] text-muted mt-0 mb-3">
        Rewards are paid in <span className="text-ink">$LOOP on Solana</span>, to the wallet that
        enrolled this device. Claiming is self-serve: you sign the transaction and pay the network
        fee plus your own token-account rent (~0.002 SOL, first claim only). A linked Hood address
        is stored for when $LOOP goes live on Hood — nothing pays out there yet.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => void claim()}
          disabled={!open || claiming || claimable <= 0 || (quote?.pendingLoop ?? 0) > 0}
          className="font-mono text-[12.5px] px-4 py-[8px] rounded-[10px] bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {claiming
            ? "Sign in your wallet…"
            : (quote?.pendingLoop ?? 0) > 0
              ? "Claim in flight…"
              : claimable > 0
                ? `Claim ${claimable.toLocaleString("en-US")} $LOOP`
                : "Nothing to claim yet"}
        </button>
        {!open && (
          <span className="font-mono text-[11.5px] text-faint">claims open soon</span>
        )}
        {lastClaim && (
          <a
            href={`https://solscan.io/tx/${lastClaim.sig}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11.5px] text-pos hover:underline"
          >
            ✓ claimed {lastClaim.loop.toLocaleString("en-US")} $LOOP ↗
          </a>
        )}
      </div>
      {error && <p className="font-mono text-[11.5px] text-[var(--neg)] mt-2 mb-0">{error}</p>}
    </div>
  );
}
