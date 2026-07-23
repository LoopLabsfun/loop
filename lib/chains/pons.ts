// ─────────────────────────────────────────────────────────────────────────────
// PONS — Robinhood Chain's launchpad, called DIRECTLY.
//
// Pons is a plain, verified contract, so a launch does NOT have to go through
// their web UI: `launchToken` is public and, with `launchEnabled` true, needs no
// whitelist. That means Loop can launch a Hood token from its own flow, exactly
// as it launches a Solana token through pump.fun — same seam, same automation,
// no human clicking a form on someone else's site.
//
// EVERY constant below was read from the chain, not from documentation:
//   • factory  0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB — verified source on
//     Blockscout, name `PonsLaunchFactory`
//   • launchToken selector 0x686399cb (keccak of the signature, asserted in the
//     tests against `cast calldata`)
//   • launchEnabled() = true, launchFee() = 0.0005 ETH, launchConfigCount() = 1,
//     dexConfigCount() = 1  → the only valid ids are 0 and 0
//   • dex 0   = "uniswap v3", poolFee 10000, tickSpacing 200, enabled
//   • config 0 = pairToken WETH 0x0Bd7…AD73, graduation 4.2 ETH, supply 1e27
//     (1B × 18dp), maxWallet 5%, maxTx 5.5%
// The fee is read LIVE at launch time rather than trusted from here — the owner
// can change it with setLaunchFee, and a stale constant would mean a reverted
// launch (LaunchFeeNotPaid) or an overpayment.
//
// `msg.value` = launchFee + initialBuy. The excess above the fee is the DEV BUY,
// and it goes to `feeWallet` (or msg.sender when that's the zero address) — the
// same "seed the first candle" move the Solana path makes.
//
// Pure encoder + constants; no I/O, so the calldata can be asserted byte-for-byte
// in tests. Sending lives in the caller.
// ─────────────────────────────────────────────────────────────────────────────

import { encodeAddress, encodeStringTail, encodeUint } from "./hood-calldata";

/** PonsLaunchFactory (active factory, verified on Blockscout). */
export const PONS_FACTORY = "0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB";
/** The locker that holds each launch's LP position. */
export const PONS_LOCKER = "0x736D76699C26D0d966744cAe304C000d471f7F35";
/** WETH on Robinhood Chain — the pair token every Pons launch quotes against. */
export const PONS_PAIR_TOKEN = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
/** The only enabled launch config / dex at the time of writing (both counts = 1). */
export const PONS_LAUNCH_CONFIG_ID = 0;
export const PONS_DEX_ID = 0;
/** Fallback only — always prefer the live launchFee() read. */
export const PONS_LAUNCH_FEE_WEI = BigInt(500_000_000_000_000); // 0.0005 ETH

export const PONS_SELECTORS = {
  launchToken: "686399cb",
  launchFee: "cf3cf573",
  launchEnabled: "236a4afb",
  // Locker (not the factory): pulls the LP position's accrued fees and splits
  // them — protocol share to Pons, the rest to the launch's fee recipient
  // (our treasury, wired via feeWallet at launch). Callable by the deployer,
  // the recipient, the owner, or an allow-listed collector.
  collectFees: "a480ca79",
  protocolFeeShare: "960b26a2",
  feeRedirects: "dce780c2",
} as const;

/** Every selector above is re-derived from these signatures in the tests, so a
 *  hand-typed one can't silently become a wrong call. That check has already
 *  earned its keep: two of these constants were wrong when first written. */
export const PONS_SIGNATURES = {
  launchToken:
    "launchToken((string,string,string,string,(string,string,string,string,string),address),uint256,uint256,bytes32)",
  launchFee: "launchFee()",
  launchEnabled: "launchEnabled()",
  collectFees: "collectFees(address)",
  protocolFeeShare: "protocolFeeShare()",
  feeRedirects: "feeRedirects(address)",
} as const;

export interface PonsSocials {
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
  farcaster?: string;
}

export interface PonsTokenParams {
  name: string;
  symbol: string;
  /** Logo URL. Empty string is accepted by the contract. */
  logo?: string;
  description?: string;
  socials?: PonsSocials;
  /**
   * Receives the dev buy AND is wired as the fee-redirect recipient on the
   * locker. Zero address ⇒ the contract falls back to msg.sender, so passing
   * the project treasury here is what routes trading fees to the treasury
   * instead of to whichever wallet happened to send the transaction.
   */
  feeWallet?: string;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** A 32-byte hex salt (CREATE2). Any value works as long as the resulting pool
 *  doesn't already exist — the contract reverts with PoolAlreadyExists. */
export function isSalt(v: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
}

/** Encode a `(string,string,string,string,(…5 strings…),address)` tuple as a
 *  standalone dynamic block: 6 head words, then each dynamic member's tail. */
function encodeTokenParams(p: PonsTokenParams): string {
  const s = p.socials ?? {};
  const socialStrings = [
    s.twitter ?? "",
    s.telegram ?? "",
    s.discord ?? "",
    s.website ?? "",
    s.farcaster ?? "",
  ];

  // The nested Socials tuple is itself all-dynamic: 5 offsets then 5 tails.
  let socialsHead = "";
  let socialsTail = "";
  let socialsOffset = 5 * 32;
  for (const str of socialStrings) {
    socialsHead += encodeUint(BigInt(socialsOffset));
    const t = encodeStringTail(str);
    socialsTail += t.hex;
    socialsOffset += t.size;
  }
  const socialsBlock = socialsHead + socialsTail;

  const outerStrings = [p.name, p.symbol, p.logo ?? "", p.description ?? ""];
  let head = "";
  let tail = "";
  // 6 members: 4 strings, socials, feeWallet — offsets are relative to the
  // START of this tuple's own block, not to the start of the calldata.
  let offset = 6 * 32;
  for (const str of outerStrings) {
    head += encodeUint(BigInt(offset));
    const t = encodeStringTail(str);
    tail += t.hex;
    offset += t.size;
  }
  head += encodeUint(BigInt(offset)); // socials tuple offset
  tail += socialsBlock;
  head += encodeAddress(p.feeWallet ?? ZERO_ADDRESS);

  return head + tail;
}

/**
 * Calldata for PonsLaunchFactory.launchToken. Send it to PONS_FACTORY with
 * `value = launchFee + devBuyWei`.
 *
 * Asserted byte-for-byte against `cast calldata` in the tests — the same
 * discipline lib/chains/hood-calldata.ts uses, because a hand-rolled encoder for
 * a nested dynamic tuple is exactly the kind of code that looks right and isn't.
 */
export function encodeLaunchToken(
  params: PonsTokenParams,
  opts: { launchConfigId?: number; dexId?: number; salt: string } = { salt: "" }
): string {
  if (!params.name || !params.symbol) throw new Error("encodeLaunchToken: name and symbol are required");
  if (!isSalt(opts.salt)) throw new Error("encodeLaunchToken: salt must be 32 bytes of hex");
  const configId = BigInt(opts.launchConfigId ?? PONS_LAUNCH_CONFIG_ID);
  const dexId = BigInt(opts.dexId ?? PONS_DEX_ID);

  const paramsBlock = encodeTokenParams(params);
  // Top level: offset(params) | configId | dexId | salt, then the params block.
  const head =
    encodeUint(BigInt(4 * 32)) + encodeUint(configId) + encodeUint(dexId) + opts.salt.slice(2).toLowerCase();
  return "0x" + PONS_SELECTORS.launchToken + head + paramsBlock;
}

/** Total `msg.value` for a launch: the protocol fee plus the dev buy. Keeping
 *  this in one place stops the two being confused — underpaying reverts
 *  (LaunchFeeNotPaid) and overpaying silently becomes a bigger dev buy. */
export function launchValueWei(launchFeeWei: bigint, devBuyWei: bigint): bigint {
  if (launchFeeWei < BigInt(0) || devBuyWei < BigInt(0)) {
    throw new Error("launchValueWei: negative amount");
  }
  return launchFeeWei + devBuyWei;
}
