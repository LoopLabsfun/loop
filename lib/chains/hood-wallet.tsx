"use client";

// EVM wallet for Hood (Robinhood Chain) via the injected EIP-1193 provider
// (window.ethereum — MetaMask/Rabby/Robinhood wallet). Deliberately NOT wagmi:
// the Privy/viem provider tree already causes chunk-load issues, and the whole
// EVM surface here is a thin injected-provider wrapper + our own dependency-free
// calldata encoder (lib/chains/hood-calldata.ts). Kept separate from the Solana
// useWallet() façade so the live Solana app is untouched; the Hood trading/launch
// UI uses this hook directly. See docs/multichain-hood.md (Phase 2/3).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HOOD_CHAIN_ID,
  HOOD_DEFAULT_RPC,
  HOOD_EXPLORER,
} from "./registry";
import { hoodLauncherAddress, SELECTOR } from "./hood-abi";
import { encodeBuy, encodeCreateToken, encodeSell } from "./hood-calldata";

const HOOD_CHAIN_HEX = "0x" + HOOD_CHAIN_ID.toString(16); // 0x1237

// Minimal EIP-1193 shape (avoids pulling a wallet SDK just for types).
interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

// EIP-6963 ("Multi Injected Provider Discovery") lets every installed EVM
// wallet extension announce itself independently, instead of all of them
// fighting over the single `window.ethereum` slot — that's what makes a real
// wallet-picker possible (Rabby AND MetaMask AND Robinhood Wallet, listed).
export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string; // data: URI, supplied by the wallet itself
  rdns: string;
}
export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}
interface Eip6963AnnounceEvent extends Event {
  detail: Eip6963ProviderDetail;
}

function injected(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
}

const toHexQty = (v: bigint): string => "0x" + v.toString(16);

/** Parse a uint256 eth_call return ("0x…") into a bigint, or null on junk. */
function decodeUint(hex: unknown): bigint | null {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex) || hex === "0x") return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

// keccak256("approve(address,uint256)")[:4]
const ERC20_APPROVE = "0x095ea7b3";

export interface HoodWalletState {
  available: boolean; // an injected EVM wallet exists
  connected: boolean;
  address: string | null;
  chainId: number | null;
  wrongChain: boolean; // connected but not on Hood
  connect: () => Promise<void>;
  switchToHood: () => Promise<void>;
  /** Native ETH balance (UI units) of the connected account, or 0. */
  getEthBalance: () => Promise<number>;
  /** Tokens out for `ethInWei` on the curve (launcher quoteBuy), or null. */
  quoteBuy: (token: string, ethInWei: bigint) => Promise<bigint | null>;
  /** ETH out (fees deducted) for selling `amountWei` (launcher quoteSell), or null. */
  quoteSell: (token: string, amountWei: bigint) => Promise<bigint | null>;
  /** buy(token, minOut) with `ethInWei` value → tx hash. */
  buy: (token: string, ethInWei: bigint, minOutWei: bigint) => Promise<string>;
  /** approve(launcher, amount) then sell(token, amount, minEthOut) → sell tx hash. */
  sell: (token: string, amountWei: bigint, minEthOutWei: bigint) => Promise<string>;
  /** createToken(name, symbol, minOut) with `valueWei` (creation fee + dev-buy) → tx hash. */
  createToken: (
    name: string,
    symbol: string,
    minOutWei: bigint,
    valueWei: bigint
  ) => Promise<string>;
  /** eth_sendTransaction with pre-mapped params (Relay deposit — EVM leg of an
   *  in-app cross-chain swap). Resolves with the tx hash. */
  sendRawTx: (params: Record<string, string>) => Promise<string>;
  /** Send a contract call from the user's own wallet: `to` + calldata + value.
   *  Used by the Pons launch, where the CREATOR pays the protocol fee and dev
   *  buy rather than the platform. Resolves with the tx hash. */
  sendTx: (to: string, data: string, valueWei?: bigint) => Promise<string>;
  /** EIP-191 personal_sign over `message` — no tx, no gas. */
  signMessage: (message: string) => Promise<string>;
  /** Every EIP-6963-announced wallet extension found in this browser (for the picker). */
  providers: Eip6963ProviderDetail[];
  /** Connect to a specific detected provider (from `providers`), by its uuid. */
  connectWith: (uuid: string) => Promise<void>;
}

export function useHoodWallet(): HoodWalletState {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [providers, setProviders] = useState<Eip6963ProviderDetail[]>([]);
  // The provider the user actually picked (or the sole/legacy one) — every
  // call after connect() goes through this, not always window.ethereum,
  // otherwise a non-default wallet choice would silently be ignored.
  const chosenProviderRef = useRef<Eip1193Provider | null>(null);
  const getProvider = useCallback((): Eip1193Provider | null => chosenProviderRef.current ?? injected(), []);
  const available = typeof window !== "undefined" && (!!injected() || providers.length > 0);

  // EIP-6963 discovery: listen for every wallet extension's self-announcement,
  // then ask them all to announce (covers ones that loaded before we listened).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = new Map<string, Eip6963ProviderDetail>();
    const onAnnounce = (e: Event) => {
      const { detail } = e as Eip6963AnnounceEvent;
      if (!detail?.info?.uuid || seen.has(detail.info.uuid)) return;
      seen.set(detail.info.uuid, detail);
      setProviders(Array.from(seen.values()));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  // Reconcile from the injected wallet on mount + subscribe to account/chain changes.
  useEffect(() => {
    const p = getProvider();
    if (!p) return;
    let cancelled = false;
    void (async () => {
      try {
        const accts = (await p.request({ method: "eth_accounts" })) as string[];
        const cid = (await p.request({ method: "eth_chainId" })) as string;
        if (cancelled) return;
        // Only adopt as "connected" if the wallet already has this site authorized —
        // avoids silently claiming a legacy window.ethereum before the user has
        // picked anything from the modal.
        if (accts?.[0]) chosenProviderRef.current = p;
        setAddress(accts?.[0] ?? null);
        setChainId(cid ? parseInt(cid, 16) : null);
      } catch {
        /* wallet not ready */
      }
    })();
    const onAccounts = (...a: unknown[]) => setAddress((a[0] as string[])?.[0] ?? null);
    const onChain = (...a: unknown[]) => setChainId(parseInt(a[0] as string, 16));
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    return () => {
      cancelled = true;
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
    };
  }, [getProvider]);

  const switchToHood = useCallback(async () => {
    const p = getProvider();
    if (!p) throw new Error("No EVM wallet found. Install MetaMask or Rabby.");
    try {
      await p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: HOOD_CHAIN_HEX }],
      });
    } catch (e) {
      // 4902 = chain unknown to the wallet → add it, then it's selected.
      if ((e as { code?: number })?.code === 4902) {
        await p.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: HOOD_CHAIN_HEX,
              chainName: "Robinhood Chain",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: [HOOD_DEFAULT_RPC],
              blockExplorerUrls: [HOOD_EXPLORER],
            },
          ],
        });
      } else {
        throw e;
      }
    }
  }, []);

  const connectVia = useCallback(
    async (p: Eip1193Provider) => {
      chosenProviderRef.current = p;
      const accts = (await p.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accts?.[0] ?? null);
      await switchToHood();
      const cid = (await p.request({ method: "eth_chainId" })) as string;
      setChainId(cid ? parseInt(cid, 16) : null);
    },
    [switchToHood]
  );

  // Default connect: only meaningful when there's a single/legacy provider —
  // the picker modal calls connectWith() once >1 wallet is detected.
  const connect = useCallback(async () => {
    const p = injected();
    if (!p) throw new Error("No EVM wallet found. Install MetaMask or Rabby.");
    await connectVia(p);
  }, [connectVia]);

  const connectWith = useCallback(
    async (uuid: string) => {
      const detail = providers.find((d) => d.info.uuid === uuid);
      if (!detail) throw new Error("That wallet is no longer available.");
      await connectVia(detail.provider);
    },
    [providers, connectVia]
  );

  const ethCall = useCallback(async (to: string, data: string): Promise<unknown> => {
    const p = getProvider();
    if (!p) return null;
    return p.request({ method: "eth_call", params: [{ to, data }, "latest"] });
  }, [getProvider]);

  const getEthBalance = useCallback(async (): Promise<number> => {
    const p = getProvider();
    if (!p || !address) return 0;
    try {
      const hex = (await p.request({ method: "eth_getBalance", params: [address, "latest"] })) as string;
      const wei = decodeUint(hex);
      return wei === null ? 0 : Number(wei) / 1e18;
    } catch {
      return 0;
    }
  }, [address]);

  const quoteBuy = useCallback(
    async (token: string, ethInWei: bigint): Promise<bigint | null> => {
      const launcher = hoodLauncherAddress();
      if (!launcher) return null;
      const data =
        SELECTOR.quoteBuy +
        token.slice(2).toLowerCase().padStart(64, "0") +
        ethInWei.toString(16).padStart(64, "0");
      return decodeUint(await ethCall(launcher, data));
    },
    [ethCall]
  );

  const quoteSell = useCallback(
    async (token: string, amountWei: bigint): Promise<bigint | null> => {
      const launcher = hoodLauncherAddress();
      if (!launcher) return null;
      const data =
        SELECTOR.quoteSell +
        token.slice(2).toLowerCase().padStart(64, "0") +
        amountWei.toString(16).padStart(64, "0");
      return decodeUint(await ethCall(launcher, data));
    },
    [ethCall]
  );

  const sendTx = useCallback(
    async (to: string, data: string, valueWei = BigInt(0)): Promise<string> => {
      const p = getProvider();
      if (!p) throw new Error("No EVM wallet found.");
      if (!address) throw new Error("Connect your wallet first.");
      const tx: Record<string, string> = { from: address, to, data };
      if (valueWei > BigInt(0)) tx.value = toHexQty(valueWei);
      return (await p.request({ method: "eth_sendTransaction", params: [tx] })) as string;
    },
    [address, getProvider]
  );

  const requireLauncher = (): string => {
    const launcher = hoodLauncherAddress();
    if (!launcher) throw new Error("The Hood launcher isn't deployed yet.");
    return launcher;
  };

  const buy = useCallback(
    (token: string, ethInWei: bigint, minOutWei: bigint) =>
      sendTx(requireLauncher(), encodeBuy(token, minOutWei), ethInWei),
    [sendTx]
  );

  const sell = useCallback(
    async (token: string, amountWei: bigint, minEthOutWei: bigint) => {
      const launcher = requireLauncher();
      // The launcher pulls the tokens via transferFrom → approve it first.
      const approveData =
        ERC20_APPROVE +
        launcher.slice(2).toLowerCase().padStart(64, "0") +
        amountWei.toString(16).padStart(64, "0");
      await sendTx(token, approveData);
      return sendTx(launcher, encodeSell(token, amountWei, minEthOutWei));
    },
    [sendTx]
  );

  const createToken = useCallback(
    (name: string, symbol: string, minOutWei: bigint, valueWei: bigint) =>
      sendTx(requireLauncher(), encodeCreateToken(name, symbol, minOutWei), valueWei),
    [sendTx]
  );

  // Sign an arbitrary message (EIP-191 personal_sign) — no transaction, no gas,
  // used for proof-of-ownership flows (e.g. linking this address as a Loop
  // Compute payout wallet). Returns the 0x…-prefixed 65-byte hex signature.
  const signMessage = useCallback(
    async (message: string): Promise<string> => {
      const p = getProvider();
      if (!p) throw new Error("No EVM wallet found.");
      if (!address) throw new Error("Connect your wallet first.");
      // personal_sign takes [data, address] — data must be UTF-8 hex-encoded.
      const hexMessage = "0x" + Buffer.from(message, "utf8").toString("hex");
      return (await p.request({
        method: "personal_sign",
        params: [hexMessage, address],
      })) as string;
    },
    [address, getProvider]
  );

  // Send a Relay deposit tx (already mapped to eth_sendTransaction params). The
  // `from` is forced to the connected account so a stale quote can't redirect it.
  const sendRawTx = useCallback(
    async (params: Record<string, string>): Promise<string> => {
      const p = getProvider();
      if (!p) throw new Error("No EVM wallet found.");
      if (!address) throw new Error("Connect your wallet first.");
      return (await p.request({
        method: "eth_sendTransaction",
        params: [{ ...params, from: address }],
      })) as string;
    },
    [address, getProvider]
  );

  return useMemo(
    () => ({
      available,
      connected: !!address,
      address,
      chainId,
      wrongChain: !!address && chainId !== HOOD_CHAIN_ID,
      connect,
      switchToHood,
      getEthBalance,
      quoteBuy,
      quoteSell,
      buy,
      sell,
      createToken,
      sendRawTx,
      sendTx,
      signMessage,
      providers,
      connectWith,
    }),
    [
      available,
      address,
      chainId,
      connect,
      switchToHood,
      getEthBalance,
      quoteBuy,
      quoteSell,
      buy,
      sell,
      createToken,
      sendRawTx,
      sendTx,
      signMessage,
      providers,
      connectWith,
    ]
  );
}
