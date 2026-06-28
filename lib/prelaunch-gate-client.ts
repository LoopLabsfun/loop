// Client-safe mirror of the pre-launch gate config (lib/prelaunch-gate is the
// server source of truth). The browser needs the amounts + recipient + LOOP mint
// to MAKE the two payments before submitting. NEXT_PUBLIC_* are inlined at build,
// so the gate stays OFF in the UI until the founder sets them — matching the
// server, which won't enforce until its own (non-public) vars are set.

export const GATE_LOOP_DECIMALS = 6; // $LOOP has 6 decimals (lib/chat TOKEN_DECIMALS)

export interface ClientGate {
  wallet: string | null;
  feeSol: number;
  loopAmount: number;
  loopMint: string | null;
  required: boolean;
}

export function clientGate(): ClientGate {
  const wallet = (process.env.NEXT_PUBLIC_GATE_WALLET ?? "").trim() || null;
  const feeSol = Number(process.env.NEXT_PUBLIC_GATE_FEE_SOL) || 0;
  const loopAmount = Number(process.env.NEXT_PUBLIC_GATE_LOOP_AMOUNT) || 0;
  const loopMint =
    (process.env.NEXT_PUBLIC_GATE_LOOP_MINT ?? process.env.NEXT_PUBLIC_LOOP_MINT ?? "").trim() || null;
  const required = !!wallet && (feeSol > 0 || (loopAmount > 0 && !!loopMint));
  return { wallet, feeSol, loopAmount, loopMint, required };
}
