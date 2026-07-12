"use client";

// Client-side chain mode (solana/hood) for the whole app — the header's
// Solana / Hood switch. Orthogonal to lib/network.tsx (the Solana cluster
// switch, which only applies while chain = solana). Drives which projects the
// landing lists, which chain the Launch modal targets, and (later) which
// wallet stack is active. See docs/multichain-hood.md.
//
// The initial value comes from NEXT_PUBLIC_DEFAULT_CHAIN (default solana);
// the user's choice is persisted to localStorage and reconciled after mount to
// avoid an SSR hydration mismatch — same pattern as NetworkProvider.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { isChain, type Chain } from "./types";

const STORAGE_KEY = "loop.chain";

function envDefault(): Chain {
  return process.env.NEXT_PUBLIC_DEFAULT_CHAIN === "hood" ? "hood" : "solana";
}

interface ChainState {
  chain: Chain;
  setChain: (c: Chain) => void;
  toggle: () => void;
  /** True once the persisted value has been read on the client. */
  ready: boolean;
}

const ChainContext = createContext<ChainState | null>(null);

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const [chain, setChainState] = useState<Chain>(envDefault);
  const [ready, setReady] = useState(false);

  // Reconcile from localStorage after mount (server can't read it).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isChain(saved)) setChainState(saved);
    } catch {
      /* localStorage unavailable — keep the env default */
    }
    setReady(true);
  }, []);

  const setChain = useCallback((c: Chain) => {
    setChainState(c);
    try {
      window.localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* ignore persistence failures */
    }
  }, []);

  const toggle = useCallback(
    () => setChain(chain === "solana" ? "hood" : "solana"),
    [chain, setChain]
  );

  const value = useMemo(
    () => ({ chain, setChain, toggle, ready }),
    [chain, setChain, toggle, ready]
  );

  return <ChainContext.Provider value={value}>{children}</ChainContext.Provider>;
}

export function useChain(): ChainState {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error("useChain must be used within a ChainProvider");
  return ctx;
}
