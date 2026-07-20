"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useHoodWallet } from "@/lib/chains/hood-wallet";
import { parseUnits } from "@/lib/chains/units";
import { LoopMark } from "../LoopMark";
import { HoodMark } from "../HoodMark";
import type { BridgeChain, NormalizedBridgeQuote } from "@/lib/bridge";

// Cross-chain bridge panel: price a SOL→Hood (or Hood→SOL) move live and hand
// off to Relay's audited app to execute. Quotes are REAL via our /api/bridge/
// quote proxy (relay.link). Dual-wallet: the Solana adapter supplies the SOL
// side, the injected EVM wallet the Hood side — both are the user's own, the
// bridge is never custodial. In-app one-click execution folds in with the Hood
// launch; until then the "Open in Relay" handoff keeps it real today.

const DECIMALS: Record<BridgeChain, number> = { solana: 9, hood: 18 };
const SYMBOL: Record<BridgeChain, string> = { solana: "SOL", hood: "ETH" };

interface Dir {
  from: BridgeChain;
  to: BridgeChain;
}
const SOL_TO_HOOD: Dir = { from: "solana", to: "hood" };
const HOOD_TO_SOL: Dir = { from: "hood", to: "solana" };

function ChainBadge({ chain }: { chain: BridgeChain }) {
  return (
    <span className="inline-flex items-center gap-[6px] font-mono text-[12px]">
      {chain === "hood" ? (
        <HoodMark size={15} />
      ) : (
        <LoopMark width={18} height={11} stroke="var(--accent)" />
      )}
      {chain === "hood" ? "Hood" : "Solana"}
      <span className="text-faint">· {SYMBOL[chain]}</span>
    </span>
  );
}

export function BridgeCard() {
  const sol = useWallet();
  const hood = useHoodWallet();
  const [dir, setDir] = useState<Dir>(SOL_TO_HOOD);
  const [amount, setAmount] = useState("0.1");
  const [quote, setQuote] = useState<NormalizedBridgeQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const userAddr = dir.from === "solana" ? sol.address : hood.address;
  const recipientAddr = dir.to === "solana" ? sol.address : hood.address;
  const bothConnected = !!userAddr && !!recipientAddr;

  const fetchQuote = useCallback(async () => {
    setError(null);
    const units = parseUnits(amount, DECIMALS[dir.from]);
    if (units === null || units <= BigInt(0)) {
      setQuote(null);
      return;
    }
    if (!userAddr || !recipientAddr) {
      setQuote(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch("/api/bridge/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromChain: dir.from,
          toChain: dir.to,
          user: userAddr,
          recipient: recipientAddr,
          amount: units.toString(),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { quote?: NormalizedBridgeQuote; error?: string }
        | null;
      if (mine !== seq.current) return; // a newer request superseded this one
      if (!res.ok || !json?.quote) {
        setQuote(null);
        setError(json?.error || "No route for this amount right now.");
      } else {
        setQuote(json.quote);
      }
    } catch {
      if (mine === seq.current) setError("Bridge is unreachable — try again.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [amount, dir, userAddr, recipientAddr]);

  // Debounced live quote as amount / direction / wallets change.
  useEffect(() => {
    const t = setTimeout(() => void fetchQuote(), 400);
    return () => clearTimeout(t);
  }, [fetchQuote]);

  const flip = () => {
    setDir((d) => (d.from === "solana" ? HOOD_TO_SOL : SOL_TO_HOOD));
    setQuote(null);
  };

  // Relay's audited app, pre-pointed at this pair, for real execution today.
  const relayHref = "https://relay.link/bridge";

  return (
    <div className="bg-surface border border-line-2 rounded-[18px] p-[22px] max-w-[440px] w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="font-display font-semibold text-[16px]">
          Bridge{" "}
          <span className="font-mono text-[10px] text-accent-text align-middle ml-1 px-[6px] py-[2px] rounded-[5px] border border-accent-300">
            BETA
          </span>
        </div>
        <span className="font-mono text-[11px] text-faint">via Relay</span>
      </div>

      {/* From / to with a flip control */}
      <div className="rounded-[12px] border border-line-3 bg-canvas px-4 py-3 flex items-center justify-between">
        <span className="text-[11px] text-faint uppercase tracking-wide">You send</span>
        <ChainBadge chain={dir.from} />
      </div>
      <div className="relative flex justify-center my-[6px]">
        <button
          onClick={flip}
          aria-label="Swap direction"
          className="w-[30px] h-[30px] rounded-full border border-line-3 bg-surface flex items-center justify-center text-muted hover:text-ink hover:border-line-hover transition-colors"
        >
          ↓↑
        </button>
      </div>
      <div className="rounded-[12px] border border-line-3 bg-canvas px-4 py-3 flex items-center justify-between">
        <span className="text-[11px] text-faint uppercase tracking-wide">You receive</span>
        <ChainBadge chain={dir.to} />
      </div>

      {/* Amount */}
      <div className="mt-4">
        <label className="text-[11px] text-faint uppercase tracking-wide">
          Amount ({SYMBOL[dir.from]})
        </label>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder="0.0"
          className="mt-1 w-full bg-canvas border border-line-3 rounded-[10px] px-3 py-[10px] font-mono text-[15px] text-ink outline-none focus:border-line-hover transition-colors"
        />
      </div>

      {/* Quote readout */}
      <div className="mt-4 rounded-[12px] bg-surface-2 border border-line-4 px-4 py-3 min-h-[92px] flex flex-col justify-center">
        {!bothConnected ? (
          <ConnectPrompts dir={dir} sol={sol} hood={hood} />
        ) : loading && !quote ? (
          <div className="font-mono text-[12.5px] text-faint">Fetching live quote…</div>
        ) : error ? (
          <div className="font-mono text-[12.5px] text-[var(--neg)]">{error}</div>
        ) : quote ? (
          <div className="flex flex-col gap-[7px]">
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] text-muted">You receive</span>
              <span className="font-display font-semibold text-[18px] text-ink">
                ≈ {trim(quote.out.formatted)} {quote.out.symbol}
                {quote.out.usd != null && (
                  <span className="font-mono text-[12px] text-faint ml-2">
                    ${quote.out.usd.toFixed(2)}
                  </span>
                )}
              </span>
            </div>
            <Row
              label="Rate"
              value={quote.rate ? `1 ${quote.in.symbol} ≈ ${trim(String(quote.rate))} ${quote.out.symbol}` : "—"}
            />
            <Row
              label="Network fees"
              value={quote.totalFeesUsd != null ? `$${quote.totalFeesUsd.toFixed(2)}` : "—"}
            />
            <Row
              label="Est. time"
              value={quote.etaSeconds != null ? `~${quote.etaSeconds}s` : "—"}
            />
          </div>
        ) : (
          <div className="font-mono text-[12.5px] text-faint">Enter an amount for a live quote.</div>
        )}
      </div>

      {/* Execute — hands off to Relay's audited app (non-custodial). In-app
          one-click execution folds in with the Hood launch. */}
      <a
        href={relayHref}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-4 block text-center font-display font-semibold text-[14px] px-5 py-[12px] rounded-[12px] transition-opacity ${
          quote ? "bg-accent text-white hover:opacity-90" : "bg-line-3 text-faint pointer-events-none"
        }`}
      >
        Bridge on Relay ↗
      </a>
      <p className="font-mono text-[10.5px] text-faint mt-2 text-center leading-[1.5]">
        Quotes are live. Execution runs in Relay&apos;s audited app with your own
        wallets — funds never touch Loop.
      </p>
    </div>
  );
}

function ConnectPrompts({
  dir,
  sol,
  hood,
}: {
  dir: Dir;
  sol: ReturnType<typeof useWallet>;
  hood: ReturnType<typeof useHoodWallet>;
}) {
  const needSol = (dir.from === "solana" || dir.to === "solana") && !sol.address;
  const needHood = (dir.from === "hood" || dir.to === "hood") && !hood.address;
  return (
    <div className="flex flex-col gap-2">
      <div className="font-mono text-[12px] text-muted">
        Connect both wallets to quote this route:
      </div>
      <div className="flex gap-2 flex-wrap">
        {needSol && (
          <button
            onClick={sol.toggle}
            className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] border border-line-3 hover:border-line-hover transition-colors"
          >
            Connect Solana
          </button>
        )}
        {needHood && (
          <button
            onClick={() => void hood.connect()}
            className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] border border-line-3 hover:border-line-hover transition-colors"
          >
            Connect EVM (Hood)
          </button>
        )}
        {!needSol && !needHood && (
          <span className="font-mono text-[12px] text-pos">Both wallets connected ✓</span>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between font-mono text-[11.5px]">
      <span className="text-faint">{label}</span>
      <span className="text-muted">{value}</span>
    </div>
  );
}

// Trim a long decimal string to ~6 significant fractional digits for display.
function trim(s: string): string {
  if (!s.includes(".")) return s;
  const [w, f] = s.split(".");
  return `${w}.${f.slice(0, 6).replace(/0+$/, "") || "0"}`;
}
