import type { Launchpad } from "./types";

// The launchpad seam: turns a validated launch into a real on-chain token.
// Provider-agnostic + env-gated, mirroring the lib/solana.ts data seam.
//
// Until a provider is configured it runs in "simulated" mode: no mint / treasury
// wallet is created, so the inserted row stays within the locked-down `projects`
// RLS insert policy (which requires `mint` and `treasury_wallet` to be null for
// anon inserts). Selecting a real provider makes `createToken` mint on-chain and
// return the mint + treasury wallet; persisting those past the anon insert policy
// requires the service-role Supabase client (see lib/supabase.ts).
//
// Intended for server-side use only (imported by lib/actions.ts). Secret env
// vars have no NEXT_PUBLIC_ prefix, so they are never exposed to the browser.

export type LaunchpadProvider = "simulated" | "pumpfun" | "bags";
export type LaunchCluster = "mainnet" | "devnet";

export interface CreateTokenInput {
  name: string;
  ticker: string; // bare, uppercase, no leading "$"
  prompt: string;
  /** Base58 pubkey of the launching (creator) wallet. Verified upstream. */
  creator?: string | null;
  /** Cluster override (from the UI switch); falls back to LAUNCH_CLUSTER env. */
  cluster?: LaunchCluster;
}

export interface CreateTokenResult {
  launchpad: Launchpad;
  cluster: LaunchCluster;
  /** SPL mint address; null in simulated mode. */
  mint: string | null;
  /** Project treasury wallet pubkey; null in simulated mode. */
  treasuryWallet: string | null;
  /** Creation transaction signature, when a real launch occurred. */
  txSig: string | null;
  simulated: boolean;
}

const PROVIDER_LAUNCHPAD: Record<LaunchpadProvider, Launchpad> = {
  simulated: "Pump.fun",
  pumpfun: "Pump.fun",
  bags: "Bags.fun",
};

/** The display launchpad for a provider. */
export function providerLaunchpad(provider: LaunchpadProvider): Launchpad {
  return PROVIDER_LAUNCHPAD[provider];
}

/** Parse the LAUNCHPAD_PROVIDER env value, defaulting to "simulated". */
export function parseProvider(raw: string | undefined): LaunchpadProvider {
  return raw === "pumpfun" || raw === "bags" ? raw : "simulated";
}

/** Parse the launch cluster, defaulting to mainnet. */
export function parseCluster(raw: string | undefined): LaunchCluster {
  return raw === "devnet" ? "devnet" : "mainnet";
}

/** The no-op result used when no provider is configured. */
export function simulatedResult(
  provider: LaunchpadProvider,
  cluster: LaunchCluster
): CreateTokenResult {
  return {
    launchpad: providerLaunchpad(provider),
    cluster,
    mint: null,
    treasuryWallet: null,
    txSig: null,
    simulated: true,
  };
}

export function launchpadConfigured(): boolean {
  return parseProvider(process.env.LAUNCHPAD_PROVIDER) !== "simulated";
}

/**
 * Create the project's token on the configured launchpad. In simulated mode
 * (the default) it returns a no-op result so the prototype launch flow keeps
 * working. A configured provider mints on-chain and returns the real mint +
 * treasury wallet.
 */
export async function createToken(
  input: CreateTokenInput
): Promise<CreateTokenResult> {
  const provider = parseProvider(process.env.LAUNCHPAD_PROVIDER);
  const cluster = input.cluster ?? parseCluster(process.env.LAUNCH_CLUSTER);

  if (provider === "simulated") return simulatedResult(provider, cluster);
  if (provider === "pumpfun") return createOnPumpfun(input, cluster);
  return createOnBags(input, cluster);
}

// --- Real providers -------------------------------------------------------
// Wired structurally; the on-chain HTTP calls activate once the corresponding
// API key is set. Until then, selecting the provider fails loudly rather than
// silently faking a launch.

async function createOnPumpfun(
  _input: CreateTokenInput,
  _cluster: LaunchCluster
): Promise<CreateTokenResult> {
  const key = process.env.PUMPPORTAL_API_KEY;
  if (!key) {
    throw new Error(
      "Pump.fun launch is selected but PUMPPORTAL_API_KEY is not set."
    );
  }
  // TODO: call the PumpPortal create-token API (non-custodial: return a
  // serialized tx for the creator wallet to sign), then return the mint.
  throw new Error("Pump.fun launch integration is not implemented yet.");
}

async function createOnBags(
  _input: CreateTokenInput,
  _cluster: LaunchCluster
): Promise<CreateTokenResult> {
  const key = process.env.BAGS_API_KEY;
  if (!key) {
    throw new Error("Bags.fun launch is selected but BAGS_API_KEY is not set.");
  }
  // TODO: call the Bags.fun launch API, then return the mint + treasury wallet.
  throw new Error("Bags.fun launch integration is not implemented yet.");
}
