"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { useWallet } from "@/lib/wallet";
import type { useHoodWallet } from "@/lib/chains/hood-wallet";
import { parseUnits } from "@/lib/chains/units";
import { combineCrossChainBuy, type CrossChainBuyQuote } from "@/lib/cross-chain-buy";
import type { NormalizedBridgeQuote } from "@/lib/bridge";

// "Pay with SOL" for a Hood token — the pump.fun-style cross-chain buy. Two
// legs shown as one: A) bridge SOL -> ETH on Hood (real now via the bridge
// proxy), B) buy the token on the launcher curve with that ETH (fills once the
// launcher is live). Dual-wallet: Solana adapter funds leg A, the EVM wallet
// receives on Hood. Non-custodial — execution hands off to Relay's app.

const SOL_DECIMALS = 9;

export function CrossChainBuyPanel({
  token,
  tokenSymbol,
  deployed,
  sol,
  hood,
}: {
  token: string | null;
  tokenSymbol: string;
  deployed: boolean;
  sol: ReturnType<typeof useWallet>;
  hood: ReturnType<typeof useHoodWallet>;
}) {
  const [amount, setAmount] = useState("0.1");
  const [combined, setCombined] = useState<CrossChainBuyQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const bothConnected = !!sol.address && !!hood.address;

  const refresh = useCallback(async () => {
    setError(null);
    const lamports = parseUnits(amount, SOL_DECIMALS);
    if (lamports === null || lamports <= BigInt(0) || !sol.address || !hood.address) {
      setCombined(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    try {
      // Leg A — real bridge quote SOL -> ETH on Hood.
      const res = await fetch("/api/bridge/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromChain: "solana",
          toChain: "hood",
          user: sol.address,
          recipient: hood.address,
          amount: lamports.toString(),
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
      const bridge = json.quote;

      // Leg B — token out of the launcher curve (only once it's live).
      let tokenOutWei: bigint | null = null;
      if (deployed && token) {
        let ethWei: bigint;
        try {
          ethWei = BigInt(bridge.out.amount);
        } catch {
          ethWei = BigInt(0);
        }
        if (ethWei > BigInt(0)) {
          tokenOutWei = await hood.quoteBuy(token, ethWei);
        }
      }
      if (mine !== seq.current) return;
      setCombined(combineCrossChainBuy("SOL", bridge, tokenOutWei, tokenSymbol));
    } catch {
      if (mine === seq.current) setError("Bridge is unreachable — try again.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // `hood` covers `hood.address`: the wallet hook returns a memoized object
    // that changes identity whenever the address does, so listing both was
    // redundant, not safer.
  }, [amount, deployed, token, tokenSymbol, sol.address, hood]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 400);
    return () => clearTimeout(t);
  }, [refresh]);

  return (
    <div>
      <label className="block text-[12px] text-muted mb-[6px]">Amount in SOL</label>
      <div className="flex items-center gap-2 border border-line-3 rounded-[10px] p-1 pl-[14px] mb-[10px]">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          inputMode="decimal"
          className="flex-1 border-0 outline-none font-mono text-[16px] py-2 bg-transparent min-w-0"
        />
        <span className="font-mono text-[12px] text-faint px-[10px] py-2 bg-surface-3 rounded-[7px]">
          SOL
        </span>
      </div>

      <div className="rounded-[10px] bg-surface-2 border border-line-4 px-[14px] py-3 mb-[12px] min-h-[78px] flex flex-col justify-center">
        {!bothConnected ? (
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[12px] text-muted">
              Connect both wallets to quote a SOL → {tokenSymbol} buy:
            </span>
            <div className="flex gap-2 flex-wrap">
              {!sol.address && (
                <button
                  onClick={sol.toggle}
                  className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] border border-line-3 hover:border-line-hover transition-colors"
                >
                  Connect Solana
                </button>
              )}
              {!hood.address && (
                <button
                  onClick={() => void hood.connect()}
                  className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] border border-line-3 hover:border-line-hover transition-colors"
                >
                  Connect EVM (Hood)
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
              label={`You receive (est.)`}
              value={
                combined.token
                  ? `≈ ${combined.token.amount} ${combined.token.symbol}`
                  : `≈ ${trim(combined.bridged.amount)} ETH on Hood`
              }
              strong
            />
            {!combined.ready && (
              <div className="font-mono text-[10.5px] text-faint leading-[1.4]">
                Bridges to ETH on Hood now; the {tokenSymbol} amount fills the
                moment the launcher goes live.
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
          <span className="font-mono text-[12.5px] text-faint">Enter a SOL amount for a live quote.</span>
        )}
      </div>

      <Link
        href="/bridge"
        className={`block text-center font-display font-semibold text-[15px] py-[13px] rounded-[11px] transition-opacity ${
          combined ? "bg-accent text-white hover:opacity-90" : "bg-surface-3 text-faint pointer-events-none"
        }`}
      >
        Bridge &amp; buy with SOL →
      </Link>
      <div className="mt-[10px] text-[11px] text-faint text-center leading-[1.5]">
        Pay in SOL, receive {tokenSymbol} on Hood · bridged &amp; executed in-app
        with your own wallets, never custodial
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
