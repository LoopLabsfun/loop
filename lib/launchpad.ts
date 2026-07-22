import type { Launchpad } from "./types";
import type { Chain } from "./chains/types";

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
  /** Which chain to launch on. Selects the provider independently per chain, so
   *  Solana and Hood can be armed at the same time. Defaults to "solana". */
  chain?: Chain;
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

/** Parse a provider env value, defaulting to "simulated". */
export function parseProvider(raw: string | undefined): LaunchpadProvider {
  return raw === "spl" || raw === "pumpfun" || raw === "bags" || raw === "pons"
    ? raw
    : "simulated";
}

/** Providers that can actually mint on a given chain. A Solana provider can
 *  never serve a Hood launch and vice versa — mixing them would "succeed" while
 *  minting on the wrong chain entirely. */
const CHAIN_PROVIDERS: Record<Chain, LaunchpadProvider[]> = {
  solana: ["spl", "pumpfun", "bags"],
  hood: ["pons"],
};

/**
 * The provider for a chain. Launching on Solana and on Hood must be armable
 * INDEPENDENTLY and simultaneously — a single global LAUNCHPAD_PROVIDER can
 * only ever describe one chain, so setting it to `pumpfun` for Solana would
 * silently disarm Hood (and vice versa). Each chain reads its own variable:
 *
 *   LAUNCHPAD_PROVIDER        → Solana (kept as-is; existing deploys unchanged)
 *   LAUNCHPAD_PROVIDER_HOOD   → Hood   (defaults to "pons" when unset)
 *
 * A provider that doesn't belong to the requested chain is refused rather than
 * used: the failure mode of getting this wrong is minting a token on the wrong
 * chain, which cannot be undone.
 */
export function providerForChain(
  chain: Chain,
  env: Record<string, string | undefined> = process.env
): LaunchpadProvider {
  const raw = chain === "hood" ? env.LAUNCHPAD_PROVIDER_HOOD ?? "pons" : env.LAUNCHPAD_PROVIDER;
  const provider = parseProvider(raw);
  if (provider === "simulated") return "simulated";
  // Wrong-chain provider ⇒ simulated (a no-op), never a mint on the wrong chain.
  return CHAIN_PROVIDERS[chain].includes(provider) ? provider : "simulated";
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

export function launchpadConfigured(chain: Chain = "solana"): boolean {
  return providerForChain(chain) !== "simulated";
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
  const chain: Chain = input.chain ?? "solana";
  const provider = providerForChain(chain);
  const cluster = input.cluster ?? parseCluster(process.env.LAUNCH_CLUSTER);

  if (provider === "simulated") return simulatedResult(provider, cluster);
  if (provider === "pons") return createOnPons(input, cluster);
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

// Pons — Robinhood Chain's launchpad (its pump.fun). Called DIRECTLY: launchToken
// is a public payable function on a verified contract, so a Hood launch is one
// transaction from our own flow, not a human filling in a form on their site.
// Signed by the project's Privy EVM wallet, like every other Hood write.
// Encoder + verified constants: lib/chains/pons.ts.
async function createOnPons(
  input: CreateTokenInput,
  cluster: LaunchCluster
): Promise<CreateTokenResult> {
  const walletId = process.env.HOOD_LAUNCH_WALLET_ID;
  const walletAddress = process.env.HOOD_LAUNCH_WALLET_ADDRESS;
  if (!walletId || !walletAddress) {
    throw new Error(
      "Pons launch is selected but HOOD_LAUNCH_WALLET_ID / HOOD_LAUNCH_WALLET_ADDRESS are not set."
    );
  }
  const { launchOnPons } = await import("./chains/pons-launch");
  // The dev buy is denominated in the chain's native unit — here ETH, not SOL.
  // `devBuySol` is the seam's generic "seed the first candle" amount.
  const devBuyWei = BigInt(Math.round((input.devBuySol ?? 0) * 1e18));
  const res = await launchOnPons({
    walletId,
    walletAddress,
    devBuyWei,
    params: {
      name: input.name,
      symbol: input.ticker,
      description: input.description ?? input.prompt,
      socials: {
        twitter: input.links?.twitter,
        telegram: input.links?.telegram,
        website: input.links?.website,
      },
      // Routes the dev buy AND the locker's fee redirect to the project
      // treasury rather than to whichever wallet sent the transaction.
      feeWallet: walletAddress,
    },
  });
  return {
    launchpad: providerLaunchpad("pons"),
    cluster,
    mint: res.token,
    treasuryWallet: walletAddress,
    txSig: res.txHash,
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
