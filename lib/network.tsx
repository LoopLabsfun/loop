"use client";

// Client-side network mode (devnet/mainnet) for the whole app. Drives the
// wallet-adapter cluster (lib/wallet.tsx) and the cluster new launches target
// (LaunchModal → launchProjectAction). Per-project reads still use each
// project's stored `network` column — this switch only governs the live
// session: which chain the connected wallet talks to and where you launch.
//
// The initial value comes from NEXT_PUBLIC_SOLANA_NETWORK (default mainnet);
// the user's choice is persisted to localStorage and reconciled after mount to
// avoid an SSR hydration mismatch.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Network } from "./types";

const STORAGE_KEY = "loop.network";

function envDefault(): Network {
  // Live phase: the platform defaults to mainnet so launches/trades/wallet
  // connections target mainnet. Set NEXT_PUBLIC_SOLANA_NETWORK=devnet to flip the
  // whole site to the test cluster. Users can still toggle per session (persisted
  // to localStorage).
  return process.env.NEXT_PUBLIC_SOLANA_NETWORK === "devnet"
    ? "devnet"
    : "mainnet";
}

interface NetworkState {
  network: Network;
  setNetwork: (n: Network) => void;
  toggle: () => void;
  /** True once the persisted value has been read on the client. */
  ready: boolean;
}

const NetworkContext = createContext<NetworkState | null>(null);

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetworkState] = useState<Network>(envDefault);
  const [ready, setReady] = useState(false);

  // Reconcile from localStorage after mount (server can't read it).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "devnet" || saved === "mainnet") setNetworkState(saved);
    } catch {
      /* localStorage unavailable — keep the env default */
    }
    setReady(true);
  }, []);

  const setNetwork = useCallback((n: Network) => {
    setNetworkState(n);
    try {
      window.localStorage.setItem(STORAGE_KEY, n);
    } catch {
      /* ignore persistence failures */
    }
  }, []);

  const toggle = useCallback(
    () => setNetwork(network === "devnet" ? "mainnet" : "devnet"),
    [network, setNetwork]
  );

  const value = useMemo(
    () => ({ network, setNetwork, toggle, ready }),
    [network, setNetwork, toggle, ready]
  );

  return (
    <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkState {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error("useNetwork must be used within a NetworkProvider");
  return ctx;
}
