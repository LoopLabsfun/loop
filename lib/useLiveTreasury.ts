"use client";

import { useEffect, useState } from "react";

/** A real on-chain SOL inflow to the treasury (claim / fee route / donation). */
export interface TreasuryClaim {
  sig: string;
  sol: number;
  at: number;
  source: string;
}

export interface LiveTreasury {
  balance: number;
  /** Treasury's holding of the project's own token (UI units), or null. */
  tokenUi: number | null;
  /** Total treasury value in USD: SOL + token holdings. */
  valueUsd: number;
  /** Live USD price of one project token (for token-denominated displays). */
  tokenPriceUsd: number;
  /** Recent real SOL inflows to the treasury wallet, newest first. */
  claims: TreasuryClaim[];
  live: boolean;
}

/**
 * Polls /api/treasury/[key] for the current treasury balance + total $ value
 * (SOL plus the project token the treasury holds). When the project has an
 * on-chain treasury_wallet the values are the live Helius reading and `live` is
 * true; otherwise it's the stored snapshot. Seeds with `initialSol` so there's
 * never a flash of empty state.
 */
export function useLiveTreasury(
  key: string,
  initialSol: number,
  intervalMs = 15000
): LiveTreasury {
  const [balance, setBalance] = useState(initialSol);
  const [tokenUi, setTokenUi] = useState<number | null>(null);
  const [valueUsd, setValueUsd] = useState(0);
  const [tokenPriceUsd, setTokenPriceUsd] = useState(0);
  const [claims, setClaims] = useState<TreasuryClaim[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/treasury/${key}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (active && typeof data.balanceSol === "number") {
          setBalance(data.balanceSol);
          if (typeof data.tokenUi === "number") setTokenUi(data.tokenUi);
          if (typeof data.valueUsd === "number") setValueUsd(data.valueUsd);
          if (typeof data.tokenPriceUsd === "number") setTokenPriceUsd(data.tokenPriceUsd);
          if (Array.isArray(data.claims)) setClaims(data.claims);
          setLive(Boolean(data.live));
        }
      } catch {
        // keep the last known value
      }
    };
    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [key, intervalMs]);

  return { balance, tokenUi, valueUsd, tokenPriceUsd, claims, live };
}
