"use client";

// Real Solana wallet integration via @solana/wallet-adapter, wrapped so the
// rest of the app keeps the same small `useWallet()` surface it already used
// against the stub (connected / address / label / connect / disconnect / toggle).

import { useMemo } from "react";
import {
  clusterApiUrl,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ConnectionProvider,
  WalletProvider as AdapterWalletProvider,
  useConnection,
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
import { useNetwork } from "./network";
import { buildLaunchMessage } from "./launch-message";
import type { LaunchProof } from "./signature";

import "@solana/wallet-adapter-react-ui/styles.css";

function shorten(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
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
  const { network } = useNetwork();

  // Client-side RPC for wallet connection, per cluster. The secret Helius key is
  // never used here (it stays server-side); override with NEXT_PUBLIC_SOLANA_RPC
  // (mainnet) / NEXT_PUBLIC_SOLANA_RPC_DEVNET if you have a browser-safe
  // endpoint. Connect-only needs no privileged access.
  const endpoint = useMemo(() => {
    const override =
      network === "devnet"
        ? process.env.NEXT_PUBLIC_SOLANA_RPC_DEVNET
        : process.env.NEXT_PUBLIC_SOLANA_RPC;
    return (
      override ||
      clusterApiUrl(network === "devnet" ? "devnet" : "mainnet-beta")
    );
  }, [network]);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  // Key on the cluster so switching networks cleanly re-mounts the connection.
  return (
    <CP key={network} endpoint={endpoint}>
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
  /** Sign the canonical launch message; null if the wallet can't sign. */
  signLaunchProof: (ticker: string) => Promise<LaunchProof | null>;
  /**
   * Send `sol` SOL from the connected wallet to `to` on the active cluster
   * (a plain SystemProgram.transfer — used for project donations). Resolves
   * with the transaction signature; throws if no wallet is connected, the
   * amount is non-positive, or the address is invalid. The caller is
   * responsible for ensuring the active cluster matches the recipient.
   */
  sendSol: (to: string, sol: number) => Promise<string>;
}

export function useWallet(): WalletState {
  const { publicKey, connected, disconnect, signMessage, sendTransaction } =
    useAdapterWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const address = publicKey?.toBase58() ?? null;
  const openModal = () => setVisible(true);

  const sendSol = async (to: string, sol: number): Promise<string> => {
    if (!publicKey || !sendTransaction) {
      throw new Error("Connect a wallet first");
    }
    const lamports = Math.round(sol * LAMPORTS_PER_SOL);
    if (!Number.isFinite(lamports) || lamports <= 0) {
      throw new Error("Enter a positive amount");
    }
    const toPubkey = new PublicKey(to); // throws on an invalid address
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: publicKey, toPubkey, lamports })
    );
    const signature = await sendTransaction(tx, connection);
    // Best-effort confirmation so the UI can show a settled state; the tx is
    // already submitted, so a failed poll here is non-fatal.
    try {
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction(
        { signature, ...latest },
        "confirmed"
      );
    } catch {
      /* confirmation polling failed — the signature is still valid */
    }
    return signature;
  };

  const signLaunchProof = async (
    ticker: string
  ): Promise<LaunchProof | null> => {
    if (!publicKey || !signMessage) return null;
    const ts = Date.now();
    const message = buildLaunchMessage(ticker, ts);
    const signature = await signMessage(new TextEncoder().encode(message));
    return {
      pubkey: publicKey.toBase58(),
      signature: toBase64(signature),
      message,
    };
  };

  return {
    connected,
    address,
    label: connected && address ? shorten(address) : "Connect Wallet",
    connect: openModal,
    disconnect: () => void disconnect(),
    toggle: connected ? () => void disconnect() : openModal,
    signLaunchProof,
    sendSol,
  };
}
