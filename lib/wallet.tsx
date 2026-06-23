"use client";

// Real Solana wallet integration via @solana/wallet-adapter, wrapped behind a
// small, app-specific `useWallet()` surface (connected / address / label /
// connect / disconnect / toggle, plus the sign + balance + transfer helpers
// below) so components depend on this façade rather than the adapter directly.

import { useMemo } from "react";
import {
  clusterApiUrl,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
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
import { toBaseUnits, TOKEN_DECIMALS } from "./chat";
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
  /**
   * Sign and send a pre-built serialized transaction (e.g. a pump.fun swap
   * built server-side / by PumpPortal). Resolves with the signature; throws if
   * no wallet is connected. The caller ensures the active cluster is correct.
   */
  sendSwapTx: (txBytes: Uint8Array) => Promise<string>;
  /**
   * Transfer `uiAmount` of an SPL token (`mint`, with `decimals`) from the
   * connected wallet to `to` on the active cluster, creating the destination ATA
   * if it's missing. Used to charge $LOOP for an agent chat message (the boost
   * jumps the queue). Resolves with the signature; throws if no wallet is
   * connected, the amount is non-positive, or an address is invalid.
   */
  sendSplToken: (
    mint: string,
    to: string,
    uiAmount: number,
    decimals: number
  ) => Promise<string>;
  /**
   * The connected wallet's SOL balance (UI units) on the active cluster, or 0 if
   * no wallet is connected / the read fails. Used to fill a "Max" buy amount.
   */
  getSolBalance: () => Promise<number>;
  /**
   * The connected wallet's balance of an SPL token (`mint`, 6-decimal pump.fun
   * token by default) in UI units, or 0 if the wallet holds none / no account
   * exists. Used to fill a "Max" sell amount.
   */
  getSplBalance: (mint: string, decimals?: number) => Promise<number>;
}

export function useWallet(): WalletState {
  const { publicKey, connected, disconnect, signMessage, sendTransaction } =
    useAdapterWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const { network } = useNetwork();

  const address = publicKey?.toBase58() ?? null;
  const openModal = () => setVisible(true);

  // Read a connected wallet's balance through the server (Helius) instead of the
  // browser's public RPC, which throttles / 403s the token-account reads and made
  // "Sell · Max" see 0 $LOOP. Returns null when the server is unconfigured (no
  // key / devnet) so the caller can fall back to the direct connection read.
  const serverBalance = async (
    owner: string,
    mint?: string
  ): Promise<{ sol: number | null; token: number | null } | null> => {
    try {
      const qs = new URLSearchParams({ owner, cluster: network });
      if (mint) qs.set("mint", mint);
      const res = await fetch(`/api/wallet-balance?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) return null;
      return (await res.json()) as { sol: number | null; token: number | null };
    } catch {
      return null;
    }
  };

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

  const sendSwapTx = async (txBytes: Uint8Array): Promise<string> => {
    if (!publicKey || !sendTransaction) {
      throw new Error("Connect a wallet first");
    }
    const tx = VersionedTransaction.deserialize(txBytes);
    const signature = await sendTransaction(tx, connection);
    try {
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    } catch {
      /* confirmation polling failed — the signature is still valid */
    }
    return signature;
  };

  const sendSplToken = async (
    mint: string,
    to: string,
    uiAmount: number,
    decimals: number
  ): Promise<string> => {
    if (!publicKey || !sendTransaction) {
      throw new Error("Connect a wallet first");
    }
    const amount = toBaseUnits(uiAmount, decimals);
    if (amount <= BigInt(0)) {
      throw new Error("Enter a positive amount");
    }
    const {
      getAssociatedTokenAddress,
      getAccount,
      createAssociatedTokenAccountInstruction,
      createTransferInstruction,
    } = await import("@solana/spl-token");
    const mintPk = new PublicKey(mint); // throws on an invalid mint
    const toPk = new PublicKey(to); // throws on an invalid recipient
    const fromAta = await getAssociatedTokenAddress(mintPk, publicKey);
    const toAta = await getAssociatedTokenAddress(mintPk, toPk);
    const tx = new Transaction();
    // Create the destination's associated token account if it doesn't exist yet,
    // paid for by the sender (the treasury may never have held this token before).
    try {
      await getAccount(connection, toAta);
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(publicKey, toAta, toPk, mintPk)
      );
    }
    tx.add(createTransferInstruction(fromAta, toAta, publicKey, amount));
    const signature = await sendTransaction(tx, connection);
    try {
      const latest = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    } catch {
      /* confirmation polling failed — the signature is still valid */
    }
    return signature;
  };

  const getSolBalance = async (): Promise<number> => {
    if (!publicKey) return 0;
    // Prefer the server (Helius) read; fall back to the browser RPC only when the
    // server can't answer (unconfigured / devnet).
    const srv = await serverBalance(publicKey.toBase58());
    if (srv && typeof srv.sol === "number") return srv.sol;
    try {
      const lamports = await connection.getBalance(publicKey);
      return lamports / LAMPORTS_PER_SOL;
    } catch {
      return 0;
    }
  };

  const getSplBalance = async (
    mint: string,
    decimals: number = TOKEN_DECIMALS
  ): Promise<number> => {
    if (!publicKey) return 0;
    // Prefer the server (Helius) read — it sums across ALL the owner's token
    // accounts for this mint and isn't subject to the public RPC's throttling,
    // which is what made a real $LOOP balance read as 0 in the trade panel.
    const srv = await serverBalance(publicKey.toBase58(), mint);
    if (srv && typeof srv.token === "number") return srv.token;
    try {
      const mintPk = new PublicKey(mint); // throws on an invalid mint
      const { getAssociatedTokenAddress, getAccount } = await import(
        "@solana/spl-token"
      );
      const ata = await getAssociatedTokenAddress(mintPk, publicKey);
      const acc = await getAccount(connection, ata);
      return Number(acc.amount) / 10 ** decimals;
    } catch {
      // No associated token account / invalid mint / RPC error → holds none.
      return 0;
    }
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
    sendSwapTx,
    sendSplToken,
    getSolBalance,
    getSplBalance,
  };
}
