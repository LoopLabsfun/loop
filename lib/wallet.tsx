"use client";

// Real Solana wallet integration via @solana/wallet-adapter, wrapped so the
// rest of the app keeps the same small `useWallet()` surface it already used
// against the stub (connected / address / label / connect / disconnect / toggle).

import { useMemo } from "react";
import { clusterApiUrl } from "@solana/web3.js";
import {
  ConnectionProvider,
  WalletProvider as AdapterWalletProvider,
  useWallet as useAdapterWallet,
} from "@solana/wallet-adapter-react";
import {
  WalletModalProvider,
  useWalletModal,
} from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";

import "@solana/wallet-adapter-react-ui/styles.css";

function shorten(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

// The wallet-adapter providers are typed as React 17-era FCs whose `children`
// typing conflicts with @types/react 18.3. Cast to sidestep the false positive.
const CP = ConnectionProvider as unknown as React.FC<
  React.PropsWithChildren<{ endpoint: string }>
>;
const WP = AdapterWalletProvider as unknown as React.FC<
  React.PropsWithChildren<{ wallets: unknown[]; autoConnect?: boolean }>
>;
const WMP = WalletModalProvider as unknown as React.FC<
  React.PropsWithChildren<unknown>
>;

export function WalletProvider({ children }: { children: React.ReactNode }) {
  // Client-side RPC for wallet connection. The secret Helius key is never used
  // here (it stays server-side); override with NEXT_PUBLIC_SOLANA_RPC if you
  // have a browser-safe endpoint. Connect-only needs no privileged access.
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC || clusterApiUrl("mainnet-beta"),
    []
  );
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <CP endpoint={endpoint}>
      <WP wallets={wallets} autoConnect>
        <WMP>{children}</WMP>
      </WP>
    </CP>
  );
}

export interface WalletState {
  connected: boolean;
  address: string | null;
  label: string;
  connect: () => void;
  disconnect: () => void;
  toggle: () => void;
}

export function useWallet(): WalletState {
  const { publicKey, connected, disconnect } = useAdapterWallet();
  const { setVisible } = useWalletModal();

  const address = publicKey?.toBase58() ?? null;
  const openModal = () => setVisible(true);

  return {
    connected,
    address,
    label: connected && address ? shorten(address) : "Connect Wallet",
    connect: openModal,
    disconnect: () => void disconnect(),
    toggle: connected ? () => void disconnect() : openModal,
  };
}
