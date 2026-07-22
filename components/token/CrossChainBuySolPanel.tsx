"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { useWallet } from "@/lib/wallet";
import type { useHoodWallet } from "@/lib/chains/hood-wallet";
import { parseUnits } from "@/lib/chains/units";
import { combineCrossChainBuyToSolana, type CrossChainBuyQuote } from "@/lib/cross-chain-buy";
import type { NormalizedBridgeQuote } from "@/lib/bridge";

// "Pay with ETH on Hood" for a SOLANA token — the mirror of CrossChainBuyPanel.
// Two legs shown as one: A) bridge ETH on Hood -> SOL (real, via the bridge
// proxy), B) buy the SPL token with that SOL, estimated from its live SOL price.
// Dual-wallet: the EVM wallet funds leg A, the Solana adapter receives.
// Non-custodial — execution hands off to Relay's app, same as the other side.

const ETH_DECIMALS = 18;

export function CrossChainBuySolPanel({
  tokenSymbol,
  priceNativeSol,
  sol,
  hood,
}: {
  tokenSymbol: string;
  /** Live price in SOL per token; null pre-launch ⇒ the token leg stays an "—". */
  priceNativeSol: number | null;
  sol: ReturnType<typeof useWallet>;
  hood: ReturnType<typeof useHoodWallet>;
}) {
  const [amount, setAmount] = useState("0.01");
  const [combined, setCombined] = useState<CrossChainBuyQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const bothConnected = !!sol.address && !!hood.address;

  const refresh = useCallback(async () => {
    setError(null);
    const wei = parseUnits(amount, ETH_DECIMALS);
    if (wei === null || wei <= BigInt(0) || !sol.address || !hood.address) {
      setCombined(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    try {
      // Leg A — real bridge quote ETH on Hood -> SOL.
      const res = await fetch("/api/bridge/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromChain: "hood",
          toChain: "solana",
          user: hood.address,
          recipient: sol.address,
          amount: wei.toString(),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { quote?: NormalizedBridgeQuote; error?: string }
        | null;
      if (mine !== seq.current) return;
      if (!res.ok || !json?.quote) {
        setCombined(null);
        setError(json?.error || "No bridge route for this amount right now.");
        return;
      }
      // Leg B — priced off the token's live SOL price (no on-chain quoter).
      setCombined(
        combineCrossChainBuyToSolana("ETH", json.quote, priceNativeSol, tokenSymbol)
      );
    } catch {
      if (mine === seq.current) setError("Bridge is unreachable — try again.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [amount, priceNativeSol, tokenSymbol, sol.address, hood.address]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 400);
    return () => clearTimeout(t);
  }, [refresh]);

  return (
    <div>
      <label className="block text-[12px] text-muted mb-[6px]">Amount in ETH (Hood)</label>
      <div className="flex items-center gap-2 border border-line-3 rounded-[10px] p-1 pl-[14px] mb-[10px]">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          className="flex-1 border-0 outline-none font-mono text-[16px] py-2 bg-transparent min-w-0"
        />
        <span className="font-mono text-[12px] text-faint px-[10px] py-2 bg-surface-3 rounded-[7px]">
          ETH
        </span>
      </div>

      <div className="rounded-[10px] bg-surface-2 border border-line-4 px-[14px] py-3 mb-[12px] min-h-[78px] flex flex-col justify-center">
        {!bothConnected ? (
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[12px] text-muted">
              Connect both wallets to quote an ETH → {tokenSymbol} buy:
            </span>
            <div className="flex gap-2 flex-wrap">
              {!hood.address && (
                <button
                  onClick={() => void hood.connect()}
                  className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] border border-line-3 hover:border-line-hover transition-colors"
                >
                  Connect EVM (Hood)
                </button>
              )}
              {!sol.address && (
                <button
                  onClick={sol.toggle}
                  className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] border border-line-3 hover:border-line-hover transition-colors"
                >
                  Connect Solana
                </button>
              )}
            </div>
          </div>
        ) : loading && !combined ? (
          <span className="font-mono text-[12.5px] text-faint">Fetching live quote…</span>
        ) : error ? (
          <span className="font-mono text-[12.5px] text-[var(--neg)]">{error}</span>
        ) : combined ? (
          <div className="flex flex-col gap-[6px]">
            <Row
              label="You receive (est.)"
              value={
                combined.token
                  ? `≈ ${combined.token.amount} ${combined.token.symbol}`
                  : `≈ ${trim(combined.bridged.amount)} SOL`
              }
              strong
            />
            {!combined.ready && (
              <div className="font-mono text-[10.5px] text-faint leading-[1.4]">
                Bridges to SOL now; the {tokenSymbol} amount fills once the token
                has a live price.
              </div>
            )}
            <Row
              label="Bridge fees"
              value={combined.bridgeFeesUsd != null ? `$${combined.bridgeFeesUsd.toFixed(2)}` : "—"}
            />
            <Row
              label="Est. bridge time"
              value={combined.etaSeconds != null ? `~${combined.etaSeconds}s` : "—"}
            />
          </div>
        ) : (
          <span className="font-mono text-[12.5px] text-faint">Enter an ETH amount for a live quote.</span>
        )}
      </div>

      <Link
        href="/bridge"
        className={`block text-center font-display font-semibold text-[15px] py-[13px] rounded-[11px] transition-opacity ${
          combined ? "bg-accent text-white hover:opacity-90" : "bg-surface-3 text-faint pointer-events-none"
        }`}
      >
        Bridge &amp; buy with ETH →
      </Link>
      <div className="mt-[10px] text-[11px] text-faint text-center leading-[1.5]">
        Pay in ETH on Hood, receive {tokenSymbol} on Solana · bridged with your
        own wallets, never custodial
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[11.5px] text-faint">{label}</span>
      <span className={strong ? "font-display font-semibold text-[14px] text-ink" : "font-mono text-[11.5px] text-muted"}>
        {value}
      </span>
    </div>
  );
}

function trim(s: string): string {
  if (!s.includes(".")) return s;
  const [w, f] = s.split(".");
  return `${w}.${f.slice(0, 6).replace(/0+$/, "") || "0"}`;
}
