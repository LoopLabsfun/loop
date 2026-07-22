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

export type LaunchpadProvider = "simulated" | "spl" | "pumpfun" | "bags" | "pons";
export type LaunchCluster = "mainnet" | "devnet";

export interface CreateTokenInput {
  name: string;
  ticker: string; // bare, uppercase, no leading "$"
  prompt: string;
  /** The pump.fun-facing description (with the Loop reference). Falls back to
   *  `prompt` when unset, so callers that don't compose one still work. */
  description?: string;
  /** Base58 pubkey of the launching (creator) wallet. Verified upstream. */
  creator?: string | null;
  /** Cluster override (from the UI switch); falls back to LAUNCH_CLUSTER env. */
  cluster?: LaunchCluster;
  /** Seed dev-buy in SOL, executed atomically with create (first candle + seeds
   *  the treasury). 0/undefined = create only — the LOOP-launch bug we don't repeat. */
  devBuySol?: number;
  /** Real token logo (e.g. the pre-launch uploaded image); falls back to a placeholder. */
  logo?: { bytes: Uint8Array; contentType: string; filename: string };
  /** Social/site links carried into pump.fun metadata + DexScreener. */
  links?: { website?: string; twitter?: string; telegram?: string };
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
  spl: "Pump.fun",
  pumpfun: "Pump.fun",
  bags: "Bags.fun",
  // Robinhood Chain's launchpad — what pump.fun is to Solana. A Pons launch is
  // performed by the founder in Pons' own UI (an EVM wallet signature, no
  // contract of ours), then recorded here via scripts/launch-on-hood.ts.
  pons: "Pons",
};

/** The display launchpad for a provider. */
export function providerLaunchpad(provider: LaunchpadProvider): Launchpad {
  return PROVIDER_LAUNCHPAD[provider];
}

/** Parse the LAUNCHPAD_PROVIDER env value, defaulting to "simulated". */
export function parseProvider(raw: string | undefined): LaunchpadProvider {
  return raw === "spl" || raw === "pumpfun" || raw === "bags" || raw === "pons"
    ? raw
    : "simulated";
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
  if (provider === "spl") return createOnSpl(provider, cluster);
  if (provider === "pumpfun") return createOnPumpfun(input, cluster);
  return createOnBags(input, cluster);
}

// Direct SPL mint (no third-party launchpad). The actual minting + the heavy
// Solana libs live in ./mint-spl, imported dynamically so they stay out of the
// default server bundle.
async function createOnSpl(
  provider: LaunchpadProvider,
  cluster: LaunchCluster
): Promise<CreateTokenResult> {
  // Fail fast (and keep this branch unit-testable) before loading the
  // server-only mint module + heavy Solana libs.
  if (!process.env.LAUNCH_SIGNER_SECRET) {
    throw new Error("SPL launch is selected but LAUNCH_SIGNER_SECRET is not set.");
  }
  const { mintSplToken } = await import("./mint-spl");
  const res = await mintSplToken(cluster);
  return {
    launchpad: providerLaunchpad(provider),
    cluster,
    mint: res.mint,
    treasuryWallet: res.treasuryWallet,
    txSig: res.txSig,
    simulated: false,
  };
}

// --- Real providers -------------------------------------------------------
// Wired structurally; the on-chain HTTP calls activate once the corresponding
// API key is set. Until then, selecting the provider fails loudly rather than
// silently faking a launch.

async function createOnPumpfun(
  input: CreateTokenInput,
  cluster: LaunchCluster
): Promise<CreateTokenResult> {
  // Non-custodial Local flow — needs the creator signer, not an API key. Claims
  // a vanity mint from the pool so the pump.fun CA still ends in "Loop".
  if (!process.env.LAUNCH_SIGNER_SECRET) {
    throw new Error("Pump.fun launch needs LAUNCH_SIGNER_SECRET (the creator wallet).");
  }
  const { createOnPumpPortal } = await import("./pumpfun");
  const res = await createOnPumpPortal(
    {
      name: input.name,
      symbol: input.ticker,
      description: input.description ?? input.prompt,
      // The pieces the app path used to drop — now threaded through so a launch
      // does its first candle + real logo + links, not a bare create.
      devBuySol: input.devBuySol,
      logo: input.logo,
      links: input.links,
    },
    cluster
  );
  return {
    launchpad: "Pump.fun",
    cluster,
    mint: res.mint,
    treasuryWallet: res.treasuryWallet,
    txSig: res.txSig,
    simulated: false,
  };
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
