"use client";

// Real Solana wallet integration via @solana/wallet-adapter, wrapped behind a
// small, app-specific `useWallet()` surface (connected / address / label /
// connect / disconnect / toggle, plus the sign + balance + transfer helpers
// below) so components depend on this façade rather than the adapter directly.

import { useMemo } from "react";
import {
  clusterApiUrl,
  Connection,
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
import { buildAdminMessage } from "./admin-message";
import { buildProfileMessage } from "./profile-message";
import { buildWaitlistMessage } from "./waitlist-message";
import { buildComputeEnrollMessage } from "./compute-message";
import { toBaseUnits, TOKEN_DECIMALS, buildChatMessage } from "./chat";
import { buildDirectiveMessage } from "./directives";
import { buildStakeMessage } from "./staking";
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

// Confirm a signature by POLLING getSignatureStatuses over HTTP. We can't use the
// usual `connection.confirmTransaction` because it relies on a WebSocket
// (signatureSubscribe), and our RPC goes through the same-origin `/api/rpc`
// proxy, which only serves HTTP (no WS upgrade). Best-effort: resolves as soon as
// the tx is confirmed, and never throws — the signature is already submitted, so
// confirmation is just for the settled-state UI (paid actions are re-verified
// on-chain server-side regardless).
async function confirmByPolling(
  connection: Connection,
  signature: string,
  timeoutMs = 30000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { value } = await connection.getSignatureStatuses([signature]);
      const st = value?.[0];
      if (st?.err) return; // failed on-chain — stop waiting (explorer is the truth)
      if (
        st?.confirmationStatus === "confirmed" ||
        st?.confirmationStatus === "finalized"
      ) {
        return;
      }
    } catch {
      /* transient RPC hiccup — keep polling until the timeout */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
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
    if (override) return override;
    // Default to the same-origin server proxy → Helius (the key stays
    // server-side). The public clusterApiUrl 403s browser requests, so it's only
    // a last-resort SSR fallback before `window` is available.
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : process.env.NEXT_PUBLIC_SITE_URL;
    return origin
      ? `${origin}/api/rpc?cluster=${network}`
      : clusterApiUrl(network === "devnet" ? "devnet" : "mainnet-beta");
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
   * Sign the canonical stake message for (project, amount). The server verifies it
   * before recording a stake. null if the wallet can't sign. Moves no funds — this
   * is what lets steering avoid the per-message transfer Phantom/Blowfish flagged.
   */
  signStakeProof: (projectKey: string, amount: number) => Promise<LaunchProof | null>;
  /** Sign the canonical chat message for (project, question); null if unsupported. */
  signChatProof: (projectKey: string, question: string) => Promise<LaunchProof | null>;
  /** Sign the canonical directive message for (project, text); null if unsupported. */
  signDirectiveProof: (projectKey: string, text: string) => Promise<LaunchProof | null>;
  /** Sign the canonical founder-admin message for `projectKey` to open an admin
   *  session (the server also checks the pubkey === creator_wallet). null if unsupported. */
  signAdminProof: (projectKey: string) => Promise<LaunchProof | null>;
  /** Sign the canonical profile message for `wallet` to edit that profile (the
   *  server also checks pubkey === wallet). null if unsupported. */
  signProfileProof: (wallet: string) => Promise<LaunchProof | null>;
  /** Sign the canonical waitlist message for `wallet` to pre-launch a project (the
   *  server also checks pubkey === wallet). null if unsupported. */
  signWaitlistProof: (wallet: string) => Promise<LaunchProof | null>;
  /** Sign the canonical compute-enroll message for `wallet` to join the device
   *  pool (the server also checks pubkey === wallet). null if unsupported. */
  signComputeEnrollProof: (wallet: string) => Promise<LaunchProof | null>;
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
    // Best-effort confirmation (HTTP polling, no WS) so the UI can show a settled
    // state; the tx is already submitted, so this never blocks the result.
    await confirmByPolling(connection, signature);
    return signature;
  };

  const sendSwapTx = async (txBytes: Uint8Array): Promise<string> => {
    if (!publicKey || !sendTransaction) {
      throw new Error("Connect a wallet first");
    }
    const tx = VersionedTransaction.deserialize(txBytes);
    const signature = await sendTransaction(tx, connection);
    await confirmByPolling(connection, signature);
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
    await confirmByPolling(connection, signature);
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

  // Sign an already-built canonical message → an ed25519 ownership proof the server
  // verifies. The shared core behind every sign* helper; null when the wallet can't
  // sign. Crucially this moves NO funds, so it never trips the Phantom/Blowfish
  // transaction scanner the way the old per-message $LOOP transfer did.
  const signProof = async (message: string): Promise<LaunchProof | null> => {
    if (!publicKey || !signMessage) return null;
    const signature = await signMessage(new TextEncoder().encode(message));
    return { pubkey: publicKey.toBase58(), signature: toBase64(signature), message };
  };

  const signLaunchProof = (ticker: string): Promise<LaunchProof | null> =>
    signProof(buildLaunchMessage(ticker, Date.now()));

  const signStakeProof = (
    projectKey: string,
    amount: number
  ): Promise<LaunchProof | null> =>
    signProof(buildStakeMessage(projectKey, amount, Date.now()));

  const signChatProof = (
    projectKey: string,
    question: string
  ): Promise<LaunchProof | null> =>
    signProof(buildChatMessage(projectKey, question, Date.now()));

  const signDirectiveProof = (
    projectKey: string,
    text: string
  ): Promise<LaunchProof | null> =>
    signProof(buildDirectiveMessage(projectKey, text, Date.now()));

  const signAdminProof = (projectKey: string): Promise<LaunchProof | null> =>
    signProof(buildAdminMessage(projectKey, Date.now()));

  const signProfileProof = (wallet: string): Promise<LaunchProof | null> =>
    signProof(buildProfileMessage(wallet, Date.now()));

  const signWaitlistProof = (wallet: string): Promise<LaunchProof | null> =>
    signProof(buildWaitlistMessage(wallet, Date.now()));

  const signComputeEnrollProof = (wallet: string): Promise<LaunchProof | null> =>
    signProof(buildComputeEnrollMessage(wallet, Date.now()));

  return {
    connected,
    address,
    label: connected && address ? shorten(address) : "Connect Wallet",
    connect: openModal,
    disconnect: () => void disconnect(),
    toggle: connected ? () => void disconnect() : openModal,
    signLaunchProof,
    signStakeProof,
    signChatProof,
    signDirectiveProof,
    signAdminProof,
    signProfileProof,
    signWaitlistProof,
    signComputeEnrollProof,
    sendSol,
    sendSwapTx,
    sendSplToken,
    getSolBalance,
    getSplBalance,
  };
}
