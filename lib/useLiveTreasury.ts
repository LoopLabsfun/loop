"use client";

import { useEffect, useState } from "react";

export interface LiveTreasury {
  balance: number;
  live: boolean;
}

/**
 * Polls /api/treasury/[key] for the current treasury balance. When the project
 * has an on-chain treasury_wallet the value is the live Helius reading and
 * `live` is true; otherwise it's the stored snapshot. Seeds with `initialSol`
 * so there's never a flash of empty state.
 */
export function useLiveTreasury(
  key: string,
  initialSol: number,
  intervalMs = 15000
): LiveTreasury {
  const [balance, setBalance] = useState(initialSol);
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

  return { balance, live };
}
