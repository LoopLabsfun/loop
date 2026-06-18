"use client";

import { useEffect, useState } from "react";

export interface LiveTreasury {
  balance: number;
  /** Treasury's holding of the project's own token (UI units), or null. */
  tokenUi: number | null;
  /** Total treasury value in USD: SOL + token holdings. */
  valueUsd: number;
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

  return { balance, tokenUi, valueUsd, live };
}
