import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// AGENT WALLET CUSTODY — via Privy server wallets (external custody).
//
// The founder chose external custody (docs/loop-economics.md): Loop never holds
// the agent's raw key — Privy does, behind its API + policies. Each project's
// agent gets a Solana wallet here; its fee share funds it (the 65% agent slice),
// and the agent later signs buyback / burn / airdrop / bounty txs through Privy
// under guardrails + founder/DAO escalation for the irreversible.
//
// Plain fetch against Privy's REST API (no heavy SDK in the server bundle).
// Env-gated on PRIVY_APP_ID + PRIVY_APP_SECRET (server-only, never NEXT_PUBLIC_).
// The wallet is keyed by a deterministic external_id so it can be looked up
// later for signing without storing Privy's wallet id.
// ─────────────────────────────────────────────────────────────────────────────

const PRIVY_BASE = "https://api.privy.io/v1";

export function agentWalletConfigured(): boolean {
  return Boolean(process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET);
}

/** Deterministic Privy external_id for a project's agent wallet (≤ 64 chars). */
export function walletExternalId(projectKey: string): string {
  return `loop-agent-${projectKey}`.slice(0, 64);
}

function authHeaders(): Record<string, string> {
  const id = process.env.PRIVY_APP_ID as string;
  const secret = process.env.PRIVY_APP_SECRET as string;
  return {
    Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    "privy-app-id": id,
    "Content-Type": "application/json",
  };
}

export interface AgentWallet {
  /** Privy wallet id (used to request signatures). */
  id: string;
  /** Solana pubkey — the agent's on-chain wallet. */
  address: string;
}

/**
 * Provision a Solana agent wallet via Privy for a project. Idempotent-ish: Privy
 * keys it by external_id, so re-running returns/serves the same logical wallet
 * (look it up with `getAgentWallet`). Throws if custody isn't configured.
 */
export async function provisionAgentWallet(
  projectKey: string
): Promise<AgentWallet> {
  if (!agentWalletConfigured()) {
    throw new Error(
      "Agent wallet custody selected but PRIVY_APP_ID/PRIVY_APP_SECRET not set."
    );
  }
  const res = await fetch(`${PRIVY_BASE}/wallets`, {
    method: "POST",
    headers: authHeaders(),
    cache: "no-store",
    body: JSON.stringify({
      chain_type: "solana",
      external_id: walletExternalId(projectKey),
      display_name: `Loop agent · ${projectKey}`.slice(0, 100),
    }),
  });
  if (!res.ok) {
    throw new Error(`Privy wallet create failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { id?: string; address?: string };
  if (!json.id || !json.address) {
    throw new Error("Privy create-wallet response missing id/address.");
  }
  return { id: json.id, address: json.address };
}

/** Look up an existing agent wallet by its deterministic external_id, or null. */
export async function getAgentWallet(
  projectKey: string
): Promise<AgentWallet | null> {
  if (!agentWalletConfigured()) return null;
  const url = `${PRIVY_BASE}/wallets?external_id=${encodeURIComponent(
    walletExternalId(projectKey)
  )}`;
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: Array<{ id: string; address: string }> };
  const w = json.data?.[0];
  return w ? { id: w.id, address: w.address } : null;
}
