"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useHoodWallet } from "@/lib/chains/hood-wallet";
import { parseUnits } from "@/lib/chains/units";
import { LoopMark } from "../LoopMark";
import { HoodMark } from "../HoodMark";
import { tokensForChain, defaultToken, type SwapToken } from "@/lib/relay-tokens";
import {
  firstDeposit,
  isEvmTx,
  isSvmTx,
  toEthSendParams,
  type RelayStep,
} from "@/lib/relay-execute";
import type { BridgeChain, NormalizedBridgeQuote } from "@/lib/bridge";

// In-app cross-chain swap: any token on Solana <-> any token on Hood, quoted and
// EXECUTED inside Loop via Relay (no external handoff). The Solana adapter signs
// the SVM deposit, the injected EVM wallet the EVM deposit — both the user's own,
// non-custodial. A bridge that's also a swap.

type Status = "idle" | "quoting" | "executing" | "polling" | "done" | "error";

const SLIPPAGE_BPS = 100; // 1%

function ChainIcon({ chain, size = 15 }: { chain: BridgeChain; size?: number }) {
  return chain === "hood" ? (
    <HoodMark size={size} />
  ) : (
    <LoopMark width={size + 3} height={Math.round(size * 0.62)} stroke="var(--accent)" />
  );
}

function SideSelector({
  label,
  chain,
  token,
  onChain,
  onToken,
  extra,
}: {
  label: string;
  chain: BridgeChain;
  token: SwapToken;
  onChain: (c: BridgeChain) => void;
  onToken: (t: SwapToken) => void;
  extra?: SwapToken[];
}) {
  const tokens = tokensForChain(chain, extra);
  return (
    <div>
      <div className="flex items-center justify-between mb-[6px]">
        <span className="text-[11px] text-faint uppercase tracking-wide">{label}</span>
        <div className="flex items-center gap-1 bg-surface-2 rounded-[8px] p-[2px]">
          {(["solana", "hood"] as const).map((c) => (
            <button
              key={c}
              onClick={() => onChain(c)}
              className={`inline-flex items-center gap-[5px] font-mono text-[11px] px-[8px] py-[4px] rounded-[6px] transition-colors ${
                chain === c ? "bg-surface text-ink shadow-sm" : "text-faint"
              }`}
            >
              <ChainIcon chain={c} size={12} />
              {c === "hood" ? "Hood" : "Solana"}
            </button>
          ))}
        </div>
      </div>
      <select
        value={token.address}
        onChange={(e) => {
          const t = tokens.find((x) => x.address === e.target.value);
          if (t) onToken(t);
        }}
        className="w-full bg-canvas border border-line-3 rounded-[10px] px-3 py-[10px] font-mono text-[14px] text-ink outline-none focus:border-line-hover transition-colors cursor-pointer"
      >
        {tokens.map((t) => (
          <option key={t.address} value={t.address}>
            {t.symbol} — {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function SwapWidget({ extraTokens = [] }: { extraTokens?: SwapToken[] }) {
  const sol = useWallet();
  const hood = useHoodWallet();

  const [fromChain, setFromChain] = useState<BridgeChain>("solana");
  const [toChain, setToChain] = useState<BridgeChain>("hood");
  const [fromToken, setFromToken] = useState<SwapToken>(defaultToken("solana"));
  const [toToken, setToToken] = useState<SwapToken>(defaultToken("hood"));
  const [amount, setAmount] = useState("0.1");
  const [quote, setQuote] = useState<NormalizedBridgeQuote | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const seq = useRef(0);

  const userAddr = fromChain === "solana" ? sol.address : hood.address;
  const recipientAddr = toChain === "solana" ? sol.address : hood.address;
  const bothReady = !!userAddr && !!recipientAddr;

  const setSide = (side: "from" | "to", chain: BridgeChain) => {
    if (side === "from") {
      setFromChain(chain);
      setFromToken(defaultToken(chain));
    } else {
      setToChain(chain);
      setToToken(defaultToken(chain));
    }
    setQuote(null);
  };

  const flip = () => {
    setFromChain(toChain);
    setToChain(fromChain);
    setFromToken(toToken);
    setToToken(fromToken);
    setQuote(null);
    setStatus("idle");
  };

  const buildBody = useCallback(() => {
    const units = parseUnits(amount, fromToken.decimals);
    if (units === null || units <= BigInt(0) || !userAddr || !recipientAddr) return null;
    if (fromChain === toChain && fromToken.address === toToken.address) return null;
    return {
      fromChain,
      toChain,
      user: userAddr,
      recipient: recipientAddr,
      amount: units.toString(),
      fromCurrency: fromToken.address,
      toCurrency: toToken.address,
      slippageBps: SLIPPAGE_BPS,
    };
  }, [amount, fromToken, toToken, fromChain, toChain, userAddr, recipientAddr]);

  const fetchQuote = useCallback(async (): Promise<{ steps: RelayStep[]; requestId: string | null } | null> => {
    const body = buildBody();
    if (!body) {
      setQuote(null);
      return null;
    }
    const mine = ++seq.current;
    setStatus("quoting");
    setError(null);
    try {
      const res = await fetch("/api/bridge/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { quote?: NormalizedBridgeQuote; steps?: RelayStep[]; requestId?: string | null; error?: string }
        | null;
      if (mine !== seq.current) return null;
      if (!res.ok || !json?.quote) {
        setQuote(null);
        setStatus("idle");
        setError(json?.error || "No route for this pair/amount.");
        return null;
      }
      setQuote(json.quote);
      setStatus("idle");
      return { steps: json.steps ?? [], requestId: json.requestId ?? null };
    } catch {
      if (mine === seq.current) {
        setStatus("idle");
        setError("Swap is unreachable — try again.");
      }
      return null;
    }
  }, [buildBody]);

  // Debounced live quote as inputs change (skip while executing).
  useEffect(() => {
    if (status === "executing" || status === "polling") return;
    const t = setTimeout(() => void fetchQuote(), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, fromToken, toToken, fromChain, toChain, userAddr, recipientAddr]);

  const pollStatus = useCallback(async (requestId: string) => {
    const deadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/bridge/status?requestId=${encodeURIComponent(requestId)}`);
        const json = (await res.json().catch(() => null)) as { status?: string } | null;
        const s = json?.status;
        if (s === "success") return true;
        if (s === "failure" || s === "refund") return false;
      } catch {
        /* transient — keep polling */
      }
    }
    return false;
  }, []);

  const execute = async () => {
    setError(null);
    setTxHash(null);
    // Fresh quote → fresh steps (a deposit tx is short-lived).
    const fresh = await fetchQuote();
    if (!fresh || fresh.steps.length === 0) {
      setError("Couldn't get a fresh route — try again.");
      return;
    }
    const item = firstDeposit(fresh.steps);
    if (!item) {
      setError("No executable deposit in the route.");
      return;
    }
    setStatus("executing");
    try {
      let hash: string;
      if (fromChain === "hood") {
        if (!hood.connected) {
          await hood.connect();
        }
        if (hood.wrongChain) await hood.switchToHood();
        if (!isEvmTx(item.data)) throw new Error("Unexpected route payload for Hood.");
        hash = await hood.sendRawTx(toEthSendParams(item.data));
      } else {
        if (!isSvmTx(item.data)) throw new Error("Unexpected route payload for Solana.");
        hash = await sol.sendInstructions(
          item.data.instructions,
          item.data.addressLookupTableAddresses ?? []
        );
      }
      setTxHash(hash);
      // Bridge fill on the destination chain.
      setStatus("polling");
      const ok = fresh.requestId ? await pollStatus(fresh.requestId) : true;
      setStatus(ok ? "done" : "error");
      if (!ok) setError("The deposit landed but the destination fill is delayed — check your wallet shortly.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      setError(/reject|denied|cancel|user rejected/i.test(msg) ? "Cancelled." : msg);
      setStatus("error");
    }
  };

  const busy = status === "executing" || status === "polling";
  const cta = useMemo(() => {
    if (!bothReady) return "Connect wallets";
    if (status === "executing") return "Confirm in your wallet…";
    if (status === "polling") return "Bridging… ~a few seconds";
    if (status === "done") return "Swap complete ✓";
    if (!quote) return "Enter an amount";
    return `Swap ${fromToken.symbol} → ${toToken.symbol}`;
  }, [bothReady, status, quote, fromToken.symbol, toToken.symbol]);

  return (
    <div className="bg-surface border border-line-2 rounded-[18px] p-[22px] max-w-[440px] w-full">
      <div className="flex items-center justify-between mb-4">
        <div className="font-display font-semibold text-[16px]">
          Swap{" "}
          <span className="font-mono text-[10px] text-accent-text align-middle ml-1 px-[6px] py-[2px] rounded-[5px] border border-accent-300">
            BETA
          </span>
        </div>
        <span className="font-mono text-[11px] text-faint">Solana ↔ Hood · via Relay</span>
      </div>

      <SideSelector
        label="From"
        chain={fromChain}
        token={fromToken}
        onChain={(c) => setSide("from", c)}
        onToken={setFromToken}
        extra={extraTokens}
      />
      <div className="my-[10px]">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder="0.0"
          className="w-full bg-canvas border border-line-3 rounded-[10px] px-3 py-[10px] font-mono text-[16px] text-ink outline-none focus:border-line-hover transition-colors"
        />
      </div>

      <div className="relative flex justify-center my-[2px]">
        <button
          onClick={flip}
          aria-label="Swap direction"
          className="w-[30px] h-[30px] rounded-full border border-line-3 bg-surface flex items-center justify-center text-muted hover:text-ink hover:border-line-hover transition-colors"
        >
          ↓↑
        </button>
      </div>

      <SideSelector
        label="To"
        chain={toChain}
        token={toToken}
        onChain={(c) => setSide("to", c)}
        onToken={setToToken}
        extra={extraTokens}
      />

      {/* Quote readout */}
      <div className="mt-4 rounded-[12px] bg-surface-2 border border-line-4 px-4 py-3 min-h-[86px] flex flex-col justify-center">
        {!bothReady ? (
          <ConnectPrompts
            needSol={(fromChain === "solana" || toChain === "solana") && !sol.address}
            needHood={(fromChain === "hood" || toChain === "hood") && !hood.address}
            onSol={sol.toggle}
            onHood={() => void hood.connect()}
          />
        ) : status === "quoting" && !quote ? (
          <span className="font-mono text-[12.5px] text-faint">Fetching live quote…</span>
        ) : error && status !== "polling" ? (
          <span className="font-mono text-[12.5px] text-[var(--neg)]">{error}</span>
        ) : quote ? (
          <div className="flex flex-col gap-[7px]">
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] text-muted">You receive</span>
              <span className="font-display font-semibold text-[18px] text-ink">
                ≈ {trim(quote.out.formatted)} {quote.out.symbol}
                {quote.out.usd != null && (
                  <span className="font-mono text-[12px] text-faint ml-2">${quote.out.usd.toFixed(2)}</span>
                )}
              </span>
            </div>
            <Row label="Rate" value={quote.rate ? `1 ${quote.in.symbol} ≈ ${trim(String(quote.rate))} ${quote.out.symbol}` : "—"} />
            <Row label="Network fees" value={quote.totalFeesUsd != null ? `$${quote.totalFeesUsd.toFixed(2)}` : "—"} />
            <Row label="Est. time" value={quote.etaSeconds != null ? `~${quote.etaSeconds}s` : "—"} />
          </div>
        ) : (
          <span className="font-mono text-[12.5px] text-faint">Enter an amount for a live quote.</span>
        )}
      </div>

      <button
        onClick={() => (bothReady ? void execute() : (fromChain === "solana" || toChain === "solana" ? sol.toggle() : void hood.connect()))}
        disabled={busy || (bothReady && !quote && status !== "done")}
        className={`mt-4 w-full text-center font-display font-semibold text-[15px] py-[13px] rounded-[12px] transition-opacity disabled:opacity-60 ${
          status === "done" ? "bg-pos text-white" : "bg-accent text-white hover:opacity-90"
        }`}
      >
        {cta}
      </button>

      {status === "done" && (
        <div className="mt-[10px] font-mono text-[11.5px] text-pos text-center">
          {toToken.symbol} is on its way to your {toChain === "hood" ? "Hood" : "Solana"} wallet.
        </div>
      )}
      <p className="font-mono text-[10.5px] text-faint mt-3 text-center leading-[1.5]">
        Signed in your own wallets, executed in-app — funds never touch Loop.
      </p>
    </div>
  );
}

function ConnectPrompts({
  needSol,
  needHood,
  onSol,
  onHood,
}: {
  needSol: boolean;
  needHood: boolean;
  onSol: () => void;
  onHood: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[12px] text-muted">Connect the wallets this route needs:</span>
      <div className="flex gap-2 flex-wrap">
        {needSol && (
          <button onClick={onSol} className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] border border-line-3 hover:border-line-hover transition-colors">
            Connect Solana
          </button>
        )}
        {needHood && (
          <button onClick={onHood} className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] border border-line-3 hover:border-line-hover transition-colors">
            Connect EVM (Hood)
          </button>
        )}
        {!needSol && !needHood && <span className="font-mono text-[12px] text-pos">Wallets connected ✓</span>}
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

function trim(s: string): string {
  if (!s.includes(".")) return s;
  const [w, f] = s.split(".");
  return `${w}.${f.slice(0, 6).replace(/0+$/, "") || "0"}`;
}
