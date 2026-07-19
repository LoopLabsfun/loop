import "server-only";

// EVM agent-wallet custody for Hood (Robinhood Chain), the counterpart of the
// Solana agent wallet (lib/agent-wallet.ts). Same external-custody model: Loop
// never holds the raw key — Privy does, behind its API + policies. A project's
// Hood agent gets an `ethereum` Privy wallet here; it receives the agent fee
// share and later signs buyback / distribution / bounty txs on chain 4663.
//
// Plain fetch against Privy's REST API, reusing the shared auth/base from
// lib/agent-wallet.ts. Env-gated on PRIVY_APP_ID + PRIVY_APP_SECRET.

import {
  PRIVY_BASE,
  agentWalletConfigured,
  privyAuthHeaders,
} from "../agent-wallet";
import { HOOD_CHAIN_ID } from "./registry";

/** CAIP-2 id for Hood — Privy routes the signed tx to its RPC for this chain. */
const HOOD_CAIP2 = `eip155:${HOOD_CHAIN_ID}`;

/** Deterministic Privy external_id for a project's HOOD agent wallet. Distinct
 *  from the Solana one (`loop-agent-<key>`) so a project can hold both. */
export function hoodWalletExternalId(projectKey: string): string {
  return `loop-agent-hood-${projectKey}`.slice(0, 64);
}

export interface HoodAgentWallet {
  /** Privy wallet id (used to request signatures). */
  id: string;
  /** EVM address (0x…) — the agent's on-chain Hood wallet. */
  address: string;
}

/** Look up an existing Hood agent wallet by external_id, or null. */
export async function getHoodAgentWallet(
  projectKey: string
): Promise<HoodAgentWallet | null> {
  if (!agentWalletConfigured()) return null;
  const url = `${PRIVY_BASE}/wallets?external_id=${encodeURIComponent(
    hoodWalletExternalId(projectKey)
  )}`;
  const res = await fetch(url, { headers: privyAuthHeaders(), cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: Array<{ id: string; address: string }> };
  const w = json.data?.[0];
  return w ? { id: w.id, address: w.address } : null;
}

/**
 * Provision an EVM agent wallet via Privy for a project on Hood. Idempotent:
 * reuses the wallet keyed by this project's external_id if it already exists
 * (Privy 500s on a duplicate-external_id create, so a blind create would wedge
 * a retry). Throws if custody isn't configured.
 */
export async function provisionHoodAgentWallet(
  projectKey: string
): Promise<HoodAgentWallet> {
  if (!agentWalletConfigured()) {
    throw new Error(
      "Hood agent wallet requested but PRIVY_APP_ID/PRIVY_APP_SECRET not set."
    );
  }
  const existing = await getHoodAgentWallet(projectKey);
  if (existing) return existing;

  const res = await fetch(`${PRIVY_BASE}/wallets`, {
    method: "POST",
    headers: privyAuthHeaders(),
    cache: "no-store",
    body: JSON.stringify({
      chain_type: "ethereum",
      external_id: hoodWalletExternalId(projectKey),
      display_name: `Loop agent (Hood) · ${projectKey}`.slice(0, 100),
    }),
  });
  if (!res.ok) {
    const raced = await getHoodAgentWallet(projectKey);
    if (raced) return raced;
    throw new Error(`Privy EVM wallet create failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { id?: string; address?: string };
  if (!json.id || !json.address) {
    throw new Error("Privy create-wallet response missing id/address.");
  }
  return { id: json.id, address: json.address };
}

const toHexQty = (v: bigint): string => "0x" + v.toString(16);

/**
 * Send an EVM transaction (transfer ETH / call a contract) from a Privy-custodied
 * wallet on Hood. The raw key never leaves Privy: we hand it the tx fields and
 * Privy signs under its policies and broadcasts to chain 4663, returning the tx
 * hash. `valueWei` is the ETH sent; `data` is optional calldata (0x… for a
 * contract call, omitted for a plain transfer).
 */
export async function privySendEvmTx(
  walletId: string,
  tx: { to: string; valueWei?: bigint; data?: string }
): Promise<string> {
  if (!agentWalletConfigured()) {
    throw new Error("Privy custody not configured (PRIVY_APP_ID/PRIVY_APP_SECRET).");
  }
  const transaction: Record<string, string | number> = {
    to: tx.to,
    chain_id: HOOD_CHAIN_ID,
  };
  if (tx.valueWei && tx.valueWei > BigInt(0)) transaction.value = toHexQty(tx.valueWei);
  if (tx.data) transaction.data = tx.data;

  const res = await fetch(`${PRIVY_BASE}/wallets/${walletId}/rpc`, {
    method: "POST",
    headers: privyAuthHeaders(),
    cache: "no-store",
    body: JSON.stringify({
      method: "eth_sendTransaction",
      caip2: HOOD_CAIP2,
      params: { transaction },
    }),
  });
  if (!res.ok) {
    throw new Error(`Privy EVM sign+send failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data?: { hash?: string; transaction_hash?: string };
    hash?: string;
    transaction_hash?: string;
  };
  const hash =
    json.data?.hash ?? json.data?.transaction_hash ?? json.hash ?? json.transaction_hash;
  if (!hash) throw new Error("Privy EVM sign+send returned no transaction hash.");
  return hash;
}
