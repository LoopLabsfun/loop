"use client";

// Client helper for real pump.fun swaps. Asks our /api/swap proxy to build the
// transaction via PumpPortal, then returns the raw bytes for the connected
// wallet to sign + send. Funds only move once the user approves in their wallet.

export interface BuildSwapArgs {
  publicKey: string;
  action: "buy" | "sell";
  mint: string;
  /** SOL amount when buying, token amount when selling. */
  amount: number;
  /** Slippage tolerance in percent (default 10). */
  slippage?: number;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Build a pump.fun swap tx; returns the serialized (unsigned) tx bytes. */
export async function buildSwapTx(args: BuildSwapArgs): Promise<Uint8Array> {
  if (!args.publicKey) throw new Error("Connect your wallet to swap");
  if (!args.mint) throw new Error("Invalid token address");
  if (!Number.isFinite(args.amount) || args.amount <= 0)
    throw new Error("Enter an amount greater than zero");
  const slippage = args.slippage ?? 10;
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 100)
    throw new Error("Slippage must be between 0 and 100");

  const res = await fetch("/api/swap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: args.publicKey,
      action: args.action,
      mint: args.mint,
      amount: args.amount,
      denominatedInSol: args.action === "buy",
      slippage,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { tx?: string; error?: string };
  if (!res.ok || !data.tx) {
    throw new Error(data.error || "Could not build the swap transaction");
  }
  return fromBase64(data.tx);
}
