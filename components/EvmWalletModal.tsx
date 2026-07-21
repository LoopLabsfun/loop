"use client";

import { useEffect } from "react";
import type { Eip6963ProviderDetail } from "@/lib/chains/hood-wallet";
import { WalletIcon } from "./AuthIcons";

// EVM wallet picker for Hood connections — symmetric to the Solana adapter's
// branded Phantom/Solflare modal, instead of silently grabbing the first
// injected provider. Lists every EIP-6963-announced wallet extension found in
// this browser; if none are found, points to installing one (no dead end).
export function EvmWalletModal({
  open,
  onClose,
  providers,
  onPick,
  busyUuid,
  error,
}: {
  open: boolean;
  onClose: () => void;
  providers: Eip6963ProviderDetail[];
  onPick: (uuid: string) => void;
  busyUuid: string | null;
  error: string | null;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Connect an EVM wallet"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[360px] rounded-[16px] border border-line-3 bg-surface shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line-3">
          <span className="font-display font-medium text-[14px] text-ink">
            Connect a wallet
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-ink transition-colors text-[16px] leading-none px-1"
          >
            ×
          </button>
        </div>

        <div className="p-2">
          {providers.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <p className="text-[13px] text-muted font-mono mb-3">
                No EVM wallet detected in this browser.
              </p>
              <div className="flex flex-col gap-[6px]">
                {[
                  { name: "Robinhood Wallet", href: "https://robinhood.com/us/en/support/wallet/" },
                  { name: "Rabby", href: "https://rabby.io" },
                  { name: "MetaMask", href: "https://metamask.io" },
                ].map((w) => (
                  <a
                    key={w.name}
                    href={w.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[12.5px] text-ink border border-line-3 rounded-[10px] px-3 py-[9px] hover:border-line-hover transition-colors"
                  >
                    Install {w.name} ↗
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-[3px]">
              {providers.map((d) => (
                <button
                  key={d.info.uuid}
                  onClick={() => onPick(d.info.uuid)}
                  disabled={busyUuid !== null}
                  className="flex items-center gap-[10px] w-full text-left px-3 py-[10px] rounded-[10px] hover:bg-canvas transition-colors disabled:opacity-60"
                >
                  {d.info.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.info.icon} alt="" width={22} height={22} className="rounded-[6px]" />
                  ) : (
                    <WalletIcon size={18} className="text-muted" />
                  )}
                  <span className="font-mono text-[13px] text-ink flex-1">
                    {d.info.name}
                  </span>
                  {busyUuid === d.info.uuid ? (
                    <span className="text-[11px] text-faint font-mono">Connecting…</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {error ? (
            <p className="px-3 pt-2 pb-1 text-[12px] text-neg font-mono">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
