"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useHoodWallet } from "@/lib/chains/hood-wallet";
import { buildEvmLinkMessage, isEvmAddress, normalizeEvmAddress } from "@/lib/evm-link-message";

// Attach a Robinhood Chain (EVM) address to a Loop profile.
//
// The address is a DESTINATION, so we never take it as typed text: the user
// connects the EVM wallet and signs a free `personal_sign` message with it,
// which is what proves they can actually receive there. A pasted exchange
// address or a one-character typo simply cannot get through this — which is the
// entire point, because that class of mistake is only ever discovered after
// funds are gone.
//
// Two signatures total: the Solana one (already held by the caller, proving who
// is editing) and this EVM one (proving control of the destination).

export function EvmLink({
  wallet,
  currentAddress,
  onLinked,
  ensureProof,
}: {
  /** The profile being edited (a Solana wallet). */
  wallet: string;
  currentAddress: string | null;
  onLinked: () => void;
  /** Produces the Solana profile proof — the caller owns that flow. */
  ensureProof: () => Promise<unknown | null>;
}) {
  const sol = useWallet();
  const hood = useHoodWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const linked = currentAddress ? normalizeEvmAddress(currentAddress) : null;
  const connected = hood.address ? normalizeEvmAddress(hood.address) : null;
  const isCurrent = Boolean(linked && connected && linked === connected);

  async function submit(unlink: boolean) {
    setErr(null);
    if (!sol.address) {
      setErr("connect your Solana wallet first");
      return;
    }
    setBusy(true);
    try {
      const proof = await ensureProof();
      if (!proof) {
        setErr("wallet signature declined");
        return;
      }

      let evm: { address: string; signature: string; ts: number } | undefined;
      if (!unlink) {
        const address = connected;
        if (!address || !isEvmAddress(address)) {
          setErr("connect an EVM wallet on Robinhood Chain first");
          return;
        }
        const ts = Date.now();
        // The exact text the server rebuilds and checks — the client never gets
        // to choose what it signs.
        const message = buildEvmLinkMessage(wallet, address, ts);
        const signature = await hood.signMessage(message);
        if (!signature) {
          setErr("EVM signature declined");
          return;
        }
        evm = { address, signature, ts };
      }

      const r = await fetch("/api/profile/evm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, proof, evm, unlink }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error || "could not save");
        return;
      }
      onLinked();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {linked ? (
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="font-mono text-[12px] text-ink bg-surface-2 border border-line-4 rounded-[8px] px-2 py-[4px]">
            {linked.slice(0, 6)}…{linked.slice(-4)}
          </span>
          <span className="font-mono text-[10.5px] text-pos">✓ verified</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(true)}
            className="font-mono text-[11px] text-faint hover:text-neg transition-colors disabled:opacity-60"
          >
            remove
          </button>
        </div>
      ) : (
        <div className="text-[12px] text-muted leading-[1.5] mb-2">
          Add the address you use on Robinhood Chain. You&apos;ll sign a free
          message from it — no transaction, no gas — so we know it&apos;s yours.
        </div>
      )}

      {!hood.address ? (
        <button
          type="button"
          onClick={() => void hood.connect()}
          className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] border border-line-3 hover:border-line-hover transition-colors"
        >
          Connect EVM wallet
        </button>
      ) : isCurrent ? (
        <div className="font-mono text-[11px] text-faint">
          this is the wallet you&apos;re connected with
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit(false)}
          className="font-mono text-[12px] px-3 py-[7px] rounded-[9px] border border-line-3 hover:border-line-hover transition-colors disabled:opacity-60"
        >
          {busy
            ? "Check your wallets…"
            : `${linked ? "Replace with" : "Link"} ${connected!.slice(0, 6)}…${connected!.slice(-4)}`}
        </button>
      )}

      {err && <div className="text-[12px] text-neg font-mono mt-2">{err}</div>}
    </div>
  );
}
