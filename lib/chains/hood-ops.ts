import "server-only";

// Autonomous Hood operations — the two recurring on-chain jobs the platform
// runs once the HoodLauncher is live: FEE SWEEP (withdrawFees → treasury) and
// LOOP BUYBACK (the agent buys LOOP on the curve with its accrued ETH). The
// EVM counterpart of the Solana claim-fees + Jupiter-buyback pair.
//
// Same posture as hood-fee-distribute.ts: the decision logic is PURE and
// unit-tested; execution is a thin env-gated wrapper over the Privy-custodied
// wallets (privySendEvmTx) that stays a dry run until HOOD_OPS_ARMED=1. Every
// path no-ops cleanly while the launcher/mint/env aren't configured, so this
// can ship dormant ahead of the launch and light up with the envs.
//
// Contract auth gotcha (HoodLauncher.sol): withdrawFees() requires
// `msg.sender == treasury || msg.sender == owner`. So the sweep wallet
// (HOOD_SWEEP_WALLET_ID, a Privy wallet id) must BE the launcher's treasury or
// owner on-chain — a random platform wallet can't sweep. If the founder keeps
// an EOA (MetaMask) as treasury, sweeping stays a manual founder action and
// this sweep path simply reports pendingFees without sending.

import { HOOD_DEFAULT_RPC } from "./registry";
import { hoodLauncherAddress, SELECTOR } from "./hood-abi";
import { encodeBuy } from "./hood-calldata";
import { privySendEvmTx } from "./hood-agent-wallet";
import { agentWalletConfigured } from "../agent-wallet";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WEI_PER_ETH = BigInt("1000000000000000000");

/** Parse a decimal ETH env value into wei (no floats past 6dp of precision
 *  needed here — ops sizes, not balances). 0 on unset/junk/negative. */
export function ethEnvToWei(raw: string | undefined): bigint {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return BigInt(0);
  // 6 decimal places is plenty for ops sizing and avoids float artifacts.
  return (BigInt(Math.round(n * 1e6)) * WEI_PER_ETH) / BigInt(1e6);
}

// ── Config (read at call time so tests/env changes apply) ────────────────────

export interface HoodOpsConfig {
  /** Master arm switch — real ETH only moves when "1". */
  armed: boolean;
  /** Privy wallet id allowed to call withdrawFees (must be treasury or owner). */
  sweepWalletId: string | null;
  /** Don't sweep below this (gas + noise floor). Default 0.005 ETH. */
  sweepMinWei: bigint;
  /** The agent's Privy EVM wallet id — the buyback buyer. */
  buybackWalletId: string | null;
  /** The agent wallet's EVM address (to read its balance). */
  buybackWalletAddress: string | null;
  /** ETH to spend per buyback run. 0 = buyback disabled. */
  buybackSpendWei: bigint;
  /** Slippage floor for minTokensOut, in bps. Default 500 (5%). */
  buybackSlippageBps: number;
  /** ETH always left in the wallet for gas. Default 0.0005 ETH. */
  gasReserveWei: bigint;
}

export function hoodOpsConfig(
  env: Record<string, string | undefined> = process.env
): HoodOpsConfig {
  const slippage = Number(env.HOOD_BUYBACK_SLIPPAGE_BPS);
  const minSweep = ethEnvToWei(env.HOOD_SWEEP_MIN_ETH);
  const gasReserve = ethEnvToWei(env.HOOD_GAS_RESERVE_ETH);
  const addr = (env.HOOD_BUYBACK_WALLET_ADDRESS || "").trim();
  return {
    armed: env.HOOD_OPS_ARMED === "1",
    sweepWalletId: (env.HOOD_SWEEP_WALLET_ID || "").trim() || null,
    sweepMinWei: minSweep > BigInt(0) ? minSweep : ethEnvToWei("0.005"),
    buybackWalletId: (env.HOOD_BUYBACK_WALLET_ID || "").trim() || null,
    buybackWalletAddress: EVM_ADDRESS.test(addr) ? addr : null,
    buybackSpendWei: ethEnvToWei(env.HOOD_BUYBACK_ETH),
    buybackSlippageBps:
      Number.isFinite(slippage) && slippage >= 0 && slippage <= 10_000
        ? Math.round(slippage)
        : 500,
    gasReserveWei: gasReserve > BigInt(0) ? gasReserve : ethEnvToWei("0.0005"),
  };
}

// ── Pure planners ────────────────────────────────────────────────────────────

export interface SweepPlan {
  send: boolean;
  reason: string;
}

/** Decide whether to sweep. Pure. */
export function planHoodSweep(args: {
  pendingWei: bigint | null;
  minWei: bigint;
  walletId: string | null;
  launcher: string | null;
}): SweepPlan {
  if (!args.launcher) return { send: false, reason: "launcher not configured" };
  if (args.pendingWei === null) return { send: false, reason: "pendingFees read failed" };
  if (args.pendingWei < args.minWei) {
    return {
      send: false,
      reason: `pending ${args.pendingWei} wei below sweep floor (${args.minWei})`,
    };
  }
  if (!args.walletId) {
    return {
      send: false,
      reason: `sweepable ${args.pendingWei} wei pending — no HOOD_SWEEP_WALLET_ID (founder sweeps manually)`,
    };
  }
  return { send: true, reason: `sweep ${args.pendingWei} wei` };
}

export interface BuybackPlan {
  send: boolean;
  /** ETH actually spent (clamped to balance − gas reserve). */
  valueWei: bigint;
  /** Slippage floor passed to buy(). */
  minTokensOut: bigint;
  reason: string;
}

/** Size + floor the buyback. Pure. Clamps spend to what the wallet can afford
 *  after the gas reserve (the Solana buyback's missing clamp, fixed here). */
export function planHoodBuyback(args: {
  balanceWei: bigint | null;
  spendWei: bigint;
  gasReserveWei: bigint;
  /** quoteBuy(token, valueWei) result for the CLAMPED value, or null. */
  quotedTokensOut: bigint | null;
  slippageBps: number;
  launcher: string | null;
  token: string | null;
  walletId: string | null;
}): BuybackPlan {
  const none = (reason: string): BuybackPlan => ({
    send: false,
    valueWei: BigInt(0),
    minTokensOut: BigInt(0),
    reason,
  });
  if (!args.launcher) return none("launcher not configured");
  if (!args.token) return none("LOOP Hood mint not configured");
  if (!args.walletId) return none("no HOOD_BUYBACK_WALLET_ID");
  if (args.spendWei <= BigInt(0)) return none("buyback disabled (HOOD_BUYBACK_ETH unset)");
  if (args.balanceWei === null) return none("wallet balance read failed");
  const spendable = args.balanceWei - args.gasReserveWei;
  if (spendable <= BigInt(0)) {
    return none(`balance ${args.balanceWei} wei under the gas reserve`);
  }
  const valueWei = spendable < args.spendWei ? spendable : args.spendWei;
  if (args.quotedTokensOut === null || args.quotedTokensOut <= BigInt(0)) {
    return none("quoteBuy failed (token unknown to launcher or migrated?)");
  }
  const minTokensOut =
    (args.quotedTokensOut * BigInt(10_000 - args.slippageBps)) / BigInt(10_000);
  return {
    send: true,
    valueWei,
    minTokensOut,
    reason: `buy with ${valueWei} wei (quote ${args.quotedTokensOut}, floor ${minTokensOut})`,
  };
}

// ── Chain reads (local rpc helper, same pattern as the buybot route) ─────────

const RPC = () => process.env.HOOD_RPC_URL || HOOD_DEFAULT_RPC;

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(RPC(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) return null;
    return ((await res.json())?.result ?? null) as T | null;
  } catch {
    return null;
  }
}

function hexToWei(hex: unknown): bigint | null {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex)) return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

/** The launcher's sweepable fee balance (wei), or null on read failure. */
export async function readPendingFeesWei(launcher: string): Promise<bigint | null> {
  const hex = await rpc<string>("eth_call", [
    { to: launcher, data: SELECTOR.pendingFees },
    "latest",
  ]);
  return hexToWei(hex);
}

/** Wallet's native ETH balance in wei, or null. */
export async function readEthBalanceWei(address: string): Promise<bigint | null> {
  if (!EVM_ADDRESS.test(address)) return null;
  const hex = await rpc<string>("eth_getBalance", [address, "latest"]);
  return hexToWei(hex);
}

/** quoteBuy(token, ethInWei) → expected tokensOut (base units), or null. */
export async function readQuoteBuy(
  launcher: string,
  token: string,
  ethInWei: bigint
): Promise<bigint | null> {
  if (!EVM_ADDRESS.test(token) || ethInWei <= BigInt(0)) return null;
  const data =
    SELECTOR.quoteBuy +
    token.slice(2).toLowerCase().padStart(64, "0") +
    ethInWei.toString(16).padStart(64, "0");
  const hex = await rpc<string>("eth_call", [{ to: launcher, data }, "latest"]);
  const out = hexToWei(hex);
  return out !== null && out > BigInt(0) ? out : null;
}

// ── Execution (env-gated, dry-run by default) ────────────────────────────────

export interface HoodOpResult {
  ok: boolean;
  sent: boolean;
  hash?: string;
  note: string;
}

/**
 * Sweep the launcher's pendingFees to its treasury. Dry-run unless the config
 * is armed; even armed it only sends when the pure plan says so. The tx is a
 * bare withdrawFees() call from the configured Privy sweep wallet.
 */
export async function runHoodSweep(
  cfg: HoodOpsConfig = hoodOpsConfig()
): Promise<HoodOpResult> {
  const launcher = hoodLauncherAddress();
  const pendingWei = launcher ? await readPendingFeesWei(launcher) : null;
  const plan = planHoodSweep({
    pendingWei,
    minWei: cfg.sweepMinWei,
    walletId: cfg.sweepWalletId,
    launcher,
  });
  if (!plan.send) return { ok: true, sent: false, note: plan.reason };
  if (!cfg.armed) return { ok: true, sent: false, note: `dry run — ${plan.reason}` };
  if (!agentWalletConfigured()) {
    return { ok: false, sent: false, note: "Privy custody not configured" };
  }
  try {
    const hash = await privySendEvmTx(cfg.sweepWalletId!, {
      to: launcher!,
      data: SELECTOR.withdrawFees,
    });
    return { ok: true, sent: true, hash, note: plan.reason };
  } catch (e) {
    return {
      ok: false,
      sent: false,
      note: `sweep failed: ${e instanceof Error ? e.message : "send error"}`,
    };
  }
}

/**
 * Buy LOOP on the curve with the agent wallet's ETH. Dry-run unless armed.
 * Spend is clamped to balance − gas reserve; minTokensOut floors the fill at
 * the live quote minus slippage.
 */
export async function runHoodBuyback(
  cfg: HoodOpsConfig = hoodOpsConfig()
): Promise<HoodOpResult> {
  const launcher = hoodLauncherAddress();
  const token = (process.env.NEXT_PUBLIC_HOOD_LOOP_MINT || "").trim() || null;

  // Reads needed by the plan: balance first (to clamp), then quote the clamp.
  const balanceWei = cfg.buybackWalletAddress
    ? await readEthBalanceWei(cfg.buybackWalletAddress)
    : null;
  let clampedWei = BigInt(0);
  if (balanceWei !== null) {
    const spendable = balanceWei - cfg.gasReserveWei;
    clampedWei =
      spendable <= BigInt(0)
        ? BigInt(0)
        : spendable < cfg.buybackSpendWei
          ? spendable
          : cfg.buybackSpendWei;
  }
  const quotedTokensOut =
    launcher && token && clampedWei > BigInt(0)
      ? await readQuoteBuy(launcher, token, clampedWei)
      : null;

  const plan = planHoodBuyback({
    balanceWei,
    spendWei: cfg.buybackSpendWei,
    gasReserveWei: cfg.gasReserveWei,
    quotedTokensOut,
    slippageBps: cfg.buybackSlippageBps,
    launcher,
    token,
    walletId: cfg.buybackWalletId,
  });
  if (!plan.send) return { ok: true, sent: false, note: plan.reason };
  if (!cfg.armed) return { ok: true, sent: false, note: `dry run — ${plan.reason}` };
  if (!agentWalletConfigured()) {
    return { ok: false, sent: false, note: "Privy custody not configured" };
  }
  try {
    const hash = await privySendEvmTx(cfg.buybackWalletId!, {
      to: launcher!,
      valueWei: plan.valueWei,
      data: encodeBuy(token!, plan.minTokensOut),
    });
    return { ok: true, sent: true, hash, note: plan.reason };
  } catch (e) {
    return {
      ok: false,
      sent: false,
      note: `buyback failed: ${e instanceof Error ? e.message : "send error"}`,
    };
  }
}
