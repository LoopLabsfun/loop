"use client";

// Browser-side reads against the Pons factory, for the launch flow where the
// CREATOR sends the transaction from their own wallet.
//
// Separate from lib/chains/pons-launch.ts, which is `server-only` (it signs with
// the platform's custody wallet). This file only ever READS, over the public
// Robinhood Chain RPC, so it is safe to ship to the browser.

import { PONS_FACTORY, PONS_SELECTORS } from "./pons";

const RPC =
  process.env.NEXT_PUBLIC_HOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";

/**
 * The live protocol fee, in wei.
 *
 * Read at click time, never from a constant: the factory owner can change it
 * with setLaunchFee, and paying a stale amount reverts the launch
 * (LaunchFeeNotPaid) after the user has already approved the transaction in
 * their wallet. Throws rather than guessing — a guess here costs the user gas.
 */
export async function fetchPonsFeeWei(): Promise<bigint> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: PONS_FACTORY, data: "0x" + PONS_SELECTORS.launchFee }, "latest"],
    }),
  });
  const json = await res.json().catch(() => null);
  const hex = json?.result;
  if (!res.ok || typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Couldn't read the Pons launch fee — Robinhood Chain looks unreachable.");
  }
  return BigInt(hex);
}

/** A random 32-byte CREATE2 salt. Any value works; a fresh one per attempt
 *  avoids colliding with a pool this creator already deployed. */
export function randomSalt(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
