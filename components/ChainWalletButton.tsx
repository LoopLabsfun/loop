"use client";

import { useState } from "react";
import { useChain } from "@/lib/chains/chain-context";
import { useHoodWallet } from "@/lib/chains/hood-wallet";
import { WalletIcon } from "./AuthIcons";
import { EvmWalletModal } from "./EvmWalletModal";

// The header wallet button, chain-aware: in Solana mode it drives the existing
// Solana adapter (props from useWallet()); in Hood mode it drives the injected
// EVM wallet (Rabby / Robinhood Wallet / MetaMask via useHoodWallet). The two
// wallets are independent — a user can hold both connections at once; the
// button simply shows the one that matches the active chain.
export function ChainWalletButton({
  solConnected,
  solLabel,
  onSolToggle,
}: {
  solConnected: boolean;
  solLabel: string;
  onSolToggle: () => void;
}) {
  const { chain } = useChain();
  const hood = useHoodWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickBusyUuid, setPickBusyUuid] = useState<string | null>(null);

  const cls =
    "flex items-center gap-[7px] font-mono text-[13px] px-3 sm:px-4 py-[9px] rounded-[10px] border border-line-3 bg-surface text-ink hover:border-line-hover transition-colors whitespace-nowrap";

  if (chain !== "hood") {
    return (
      <button
        onClick={onSolToggle}
        aria-label={solConnected ? `Solana wallet ${solLabel}` : "Connect Solana wallet"}
        className={cls}
      >
        {solConnected ? (
          <span className="inline-block w-[7px] h-[7px] rounded-full bg-pos-bright" />
        ) : (
          <WalletIcon size={14} className="text-muted" />
        )}
        {solConnected ? (
          solLabel
        ) : (
          <>
            <span className="sm:hidden">Connect</span>
            <span className="hidden sm:inline">Connect Wallet</span>
          </>
        )}
      </button>
    );
  }

  const shortEvm = hood.address
    ? `${hood.address.slice(0, 6)}…${hood.address.slice(-4)}`
    : null;

  const onClick = async () => {
    setErr(null);
    if (!hood.connected) {
      // A single detected wallet (or the legacy no-6963 fallback) connects
      // directly — the picker only earns its keep when there's an actual
      // choice to make or nothing was found (install links).
      if (hood.providers.length === 1) {
        setBusy(true);
        try {
          await hood.connectWith(hood.providers[0].info.uuid);
        } catch (e) {
          setErr(e instanceof Error ? e.message : "wallet error");
        } finally {
          setBusy(false);
        }
        return;
      }
      setPickerOpen(true);
      return;
    }
    if (hood.wrongChain) {
      setBusy(true);
      try {
        await hood.switchToHood();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "wallet error");
      } finally {
        setBusy(false);
      }
    }
  };

  const onPick = async (uuid: string) => {
    setErr(null);
    setPickBusyUuid(uuid);
    try {
      await hood.connectWith(uuid);
      setPickerOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "wallet error");
    } finally {
      setPickBusyUuid(null);
    }
  };

  return (
    <>
      <button
        onClick={() => void onClick()}
        disabled={busy}
        aria-label={
          hood.connected && !hood.wrongChain
            ? `Hood wallet ${shortEvm}`
            : "Connect an EVM wallet on Robinhood Chain"
        }
        title={
          err ??
          (hood.connected && !hood.wrongChain
            ? "Connected to Robinhood Chain"
            : "Connect an EVM wallet (Rabby, Robinhood Wallet, MetaMask)")
        }
        className={`${cls} disabled:opacity-60`}
      >
        {hood.connected && !hood.wrongChain ? (
          <span className="inline-block w-[7px] h-[7px] rounded-full bg-pos-bright" />
        ) : (
          <WalletIcon size={14} className="text-muted" />
        )}
        {busy ? (
          "Connecting…"
        ) : hood.connected ? (
          hood.wrongChain ? (
            "Switch to Hood"
          ) : (
            shortEvm
          )
        ) : (
          <>
            <span className="sm:hidden">Connect</span>
            <span className="hidden sm:inline">Connect EVM Wallet</span>
          </>
        )}
      </button>
      <EvmWalletModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        providers={hood.providers}
        onPick={(uuid) => void onPick(uuid)}
        busyUuid={pickBusyUuid}
        error={err}
      />
    </>
  );
}
