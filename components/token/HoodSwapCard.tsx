"use client";

import { useEffect, useState } from "react";
import { useHoodWallet } from "@/lib/chains/hood-wallet";
import { hoodLauncherAddress } from "@/lib/chains/hood-abi";
import { chainInfo } from "@/lib/chains/registry";
import { parseUnits, formatUnits } from "@/lib/chains/units";
import type { Project } from "@/lib/types";
import { shortAddr } from "@/lib/format";

// Buy/sell a Hood token directly on the HoodLauncher bonding curve, via the
// injected EVM wallet (useHoodWallet). Quotes come live from the launcher's
// quoteBuy/quoteSell; minOut applies a slippage floor. Distinct from the Solana
// SwapCard (pump.fun path) — dispatched by chain in TokenPage.

const SLIPPAGE_PCT = 5; // the curve moves fast; a generous floor avoids reverts
const ETH = chainInfo("hood").nativeSymbol;

export function HoodSwapCard({ project: p }: { project: Project }) {
  const w = useHoodWallet();
  const token = p.mint;
  const sym = p.ticker.replace(/^\$/, "");
  const deployed = !!hoodLauncherAddress();

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amt, setAmt] = useState("0.05");
  const [quote, setQuote] = useState<bigint | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [tx, setTx] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const buy = side === "buy";

  // amount → base units (ETH when buying, the 18-decimal token when selling).
  const amountWei = parseUnits(amt || "", 18);

  // Live quote from the curve as the amount/side changes (best-effort).
  useEffect(() => {
    let cancelled = false;
    if (!deployed || !token || amountWei === null || amountWei <= BigInt(0)) {
      setQuote(null);
      return;
    }
    void (async () => {
      const q = buy
        ? await w.quoteBuy(token, amountWei)
        : await w.quoteSell(token, amountWei);
      if (!cancelled) setQuote(q);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amt, side, token, deployed, w.address]);

  // Launcher not deployed yet → honest gate (same as the pre-deploy state).
  if (!deployed) {
    return (
      <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
        <div className="font-display font-semibold text-[15px] mb-1">Trade {p.ticker}</div>
        <div className="text-[12.5px] text-muted leading-[1.5] mb-3">
          {p.ticker} lives on Hood (Robinhood Chain). Trading from this page opens
          when the Hood launcher goes live.
        </div>
        <button
          disabled
          className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[11px] bg-surface-3 text-faint cursor-not-allowed"
        >
          Hood trading opens soon
        </button>
      </div>
    );
  }

  const minOut =
    quote === null ? null : (quote * BigInt(100 - SLIPPAGE_PCT)) / BigInt(100);
  const receive =
    quote === null
      ? "—"
      : buy
      ? `${formatUnits(quote, 18, 4)} ${sym}`
      : `${formatUnits(quote, 18, 6)} ${ETH}`;

  const execute = async () => {
    if (!w.connected) {
      try {
        await w.connect();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not connect");
      }
      return;
    }
    if (w.wrongChain) {
      await w.switchToHood().catch(() => {});
      return;
    }
    if (!token || amountWei === null || amountWei <= BigInt(0) || minOut === null) return;
    setStatus("sending");
    setErr(null);
    setTx(null);
    try {
      const hash = buy
        ? await w.buy(token, amountWei, minOut)
        : await w.sell(token, amountWei, minOut);
      setTx(hash);
      setStatus("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      setErr(/reject|denied|cancel/i.test(msg) ? "Cancelled" : msg);
      setStatus("error");
    }
  };

  return (
    <div className="bg-surface border border-line-2 rounded-[16px] p-[18px]">
      <div className="grid grid-cols-2 gap-1 bg-surface-3 rounded-[10px] p-[3px] mb-[14px]">
        <button
          onClick={() => {
            setSide("buy");
            setAmt("0.05");
          }}
          className={`font-display font-semibold text-[14px] py-[9px] rounded-[8px] transition-colors ${
            buy ? "bg-[oklch(0.55_0.15_150)] text-white" : "text-muted"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => {
            setSide("sell");
            setAmt("1000");
          }}
          className={`font-display font-semibold text-[14px] py-[9px] rounded-[8px] transition-colors ${
            !buy ? "bg-[oklch(0.55_0.17_25)] text-white" : "text-muted"
          }`}
        >
          Sell
        </button>
      </div>

      <label className="block text-[12px] text-muted mb-[6px]">
        {buy ? `Amount in ${ETH}` : `Amount in ${sym}`}
      </label>
      <div className="flex items-center gap-2 border border-line-3 rounded-[10px] p-1 pl-[14px] mb-[10px]">
        <input
          value={amt}
          onChange={(e) => setAmt(e.target.value)}
          inputMode="decimal"
          className="flex-1 border-0 outline-none font-mono text-[16px] py-2 bg-transparent min-w-0"
        />
        <span className="font-mono text-[12px] text-faint px-[10px] py-2 bg-surface-3 rounded-[7px]">
          {buy ? ETH : sym}
        </span>
      </div>

      <div className="flex justify-between text-[12.5px] text-muted mb-[14px]">
        <span>You receive (est.)</span>
        <span className="font-mono text-ink">{receive}</span>
      </div>

      {w.connected && w.wrongChain ? (
        <button
          onClick={() => w.switchToHood()}
          className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[11px] border border-warn text-warn"
        >
          Switch to Hood to trade
        </button>
      ) : (
        <button
          onClick={execute}
          disabled={status === "sending" || (w.connected && (amountWei === null || amountWei <= BigInt(0)))}
          className="w-full font-display font-semibold text-[15px] py-[13px] rounded-[11px] text-white transition-opacity disabled:opacity-60"
          style={{
            background: w.connected
              ? buy
                ? "oklch(0.55 0.15 150)"
                : "oklch(0.55 0.17 25)"
              : "#16131A",
          }}
        >
          {!w.available
            ? "Install an EVM wallet"
            : !w.connected
            ? "Connect Wallet"
            : status === "sending"
            ? "Confirm in wallet…"
            : buy
            ? `Buy ${p.ticker}`
            : `Sell ${p.ticker}`}
        </button>
      )}

      {status === "done" && tx && (
        <a
          href={chainInfo("hood").explorerTx(tx)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-[10px] block font-mono text-[11.5px] text-pos bg-[oklch(0.97_0.03_150)] border border-[oklch(0.9_0.06_150)] rounded-[8px] px-3 py-[9px] animate-fadeIn"
        >
          ✓ Trade sent · {shortAddr(tx)} ↗
        </a>
      )}
      {status === "error" && err && (
        <div className="mt-[10px] font-mono text-[11.5px] text-neg bg-[oklch(0.97_0.03_25)] border border-[oklch(0.9_0.06_25)] rounded-[8px] px-3 py-[9px] animate-fadeIn">
          {err}
        </div>
      )}
      <div className="mt-[10px] text-[11px] text-faint text-center">
        Trades on the Hood bonding curve · 1% of every trade funds the treasury
      </div>
    </div>
  );
}
