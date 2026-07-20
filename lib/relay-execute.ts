// Pure helpers for executing a Relay swap/bridge IN-APP (no external handoff).
// Relay's quote returns `steps[]`; each deposit step carries either an EVM tx
// ({from,to,data,value,...}) or an SVM tx ({instructions[], addressLookupTable
// Addresses[]}). These helpers classify a step and decode its payload into the
// shapes the wallet layers consume — kept pure + tested so the fund-moving
// signing code in wallet.tsx / hood-wallet.tsx stays thin. See the executor
// wiring in components/swap/SwapWidget.tsx. Shapes captured from live
// api.relay.link/quote/v2 responses (SVM + EVM origin).

export interface RelayEvmTx {
  from: string;
  to: string;
  data: string;
  value?: string; // decimal string (wei)
  chainId?: number;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface RelaySvmInstruction {
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  programId: string;
  data: string; // hex, no 0x prefix
}

export interface RelaySvmTx {
  instructions: RelaySvmInstruction[];
  addressLookupTableAddresses?: string[];
}

export interface RelayStepItem {
  status?: string;
  data: RelayEvmTx | RelaySvmTx | Record<string, unknown>;
  check?: { endpoint: string; method: string };
}

export interface RelayStep {
  id: string;
  kind: string; // "transaction" | "signature"
  items: RelayStepItem[];
}

export function isSvmTx(d: unknown): d is RelaySvmTx {
  return !!d && typeof d === "object" && Array.isArray((d as RelaySvmTx).instructions);
}

export function isEvmTx(d: unknown): d is RelayEvmTx {
  return (
    !!d &&
    typeof d === "object" &&
    typeof (d as RelayEvmTx).to === "string" &&
    typeof (d as RelayEvmTx).data === "string" &&
    !("instructions" in (d as object))
  );
}

const toHexQty = (dec: string): string => {
  try {
    return "0x" + BigInt(dec).toString(16);
  } catch {
    return "0x0";
  }
};

/**
 * Map a Relay EVM tx to eth_sendTransaction params. value/gas fields become hex
 * quantities; a zero/absent value is omitted (a plain call). Gas is left to the
 * wallet's own estimation unless Relay provided it.
 */
export function toEthSendParams(tx: RelayEvmTx): Record<string, string> {
  const p: Record<string, string> = { from: tx.from, to: tx.to, data: tx.data };
  if (tx.value && tx.value !== "0") p.value = toHexQty(tx.value);
  if (tx.gas) p.gas = toHexQty(tx.gas);
  return p;
}

/** Decode a hex instruction-data string (no 0x) to bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) return new Uint8Array(0);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

/** The first deposit step's payload (Relay bundles the swap into one deposit). */
export function firstDeposit(steps: RelayStep[]): RelayStepItem | null {
  for (const s of steps) {
    for (const it of s.items) {
      if (it.data && (isSvmTx(it.data) || isEvmTx(it.data))) return it;
    }
  }
  return null;
}

/** Extract the Relay requestId (used to poll fill status) from a step's check. */
export function requestIdFromSteps(steps: RelayStep[]): string | null {
  for (const s of steps) {
    for (const it of s.items) {
      const m = it.check?.endpoint?.match(/requestId=([0-9a-fx]+)/i);
      if (m) return m[1];
    }
  }
  return null;
}
