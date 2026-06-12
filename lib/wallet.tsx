"use client";

// Stub wallet context. Mirrors the surface of @solana/wallet-adapter-react
// (`connected`, `connect`, `disconnect`, a short address) so it can be
// replaced by the real WalletProvider without changing consumers.

import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface WalletState {
  connected: boolean;
  address: string | null;
  label: string;
  connect: () => void;
  disconnect: () => void;
  toggle: () => void;
}

const WalletContext = createContext<WalletState | null>(null);

const MOCK_ADDRESS = "7xKq…g4fR";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => setConnected(true), []);
  const disconnect = useCallback(() => setConnected(false), []);
  const toggle = useCallback(() => setConnected((c) => !c), []);

  const value = useMemo<WalletState>(
    () => ({
      connected,
      address: connected ? MOCK_ADDRESS : null,
      label: connected ? MOCK_ADDRESS : "Connect Wallet",
      connect,
      disconnect,
      toggle,
    }),
    [connected, connect, disconnect, toggle]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
