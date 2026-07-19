// Hand-rolled ABI calldata encoder for the HoodLauncher writes (createToken /
// buy / sell). Dependency-free (no viem/ethers) — same posture as the reader in
// hood.ts, so the EVM trading path adds zero heavy deps. The encodings are
// asserted byte-for-byte against `cast calldata` output in the tests.
//
// State-changing selectors (keccak256(sig)[:4], from `cast sig`):
//   createToken(string,string,uint256) = 0x5b060530
//   buy(address,uint256)               = 0xcce7ec13
//   sell(address,uint256,uint256)      = 0x6a272462

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const WRITE_SELECTOR = {
  createToken: "5b060530",
  buy: "cce7ec13",
  sell: "6a272462",
} as const;

/** A uint as a 32-byte (64-hex) big-endian word. Rejects negatives. */
export function encodeUint(v: bigint): string {
  if (v < BigInt(0)) throw new Error("encodeUint: negative");
  return v.toString(16).padStart(64, "0");
}

/** An address as a right-aligned 32-byte word (lowercased, no checksum). */
export function encodeAddress(addr: string): string {
  if (!EVM_ADDRESS.test(addr)) throw new Error(`encodeAddress: bad address ${addr}`);
  return addr.slice(2).toLowerCase().padStart(64, "0");
}

/** Hex of a string's UTF-8 bytes, right-padded to a whole number of 32-byte words. */
function utf8Padded(s: string): { byteLen: number; hex: string } {
  const bytes = new TextEncoder().encode(s);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  const words = Math.ceil(bytes.length / 32);
  return { byteLen: bytes.length, hex: hex.padEnd(words * 64, "0") };
}

/** The dynamic `bytes`/`string` tail: length word + padded data. */
function encodeStringTail(s: string): { size: number; hex: string } {
  const { byteLen, hex } = utf8Padded(s);
  return { size: 32 + hex.length / 2, hex: encodeUint(BigInt(byteLen)) + hex };
}

/**
 * createToken(name, symbol, minTokensOut) calldata. `msg.value` (sent
 * separately) is the creation fee + any initial dev-buy; `minTokensOut` is the
 * anti-snipe floor for that dev-buy (0 when there's no initial buy).
 */
export function encodeCreateToken(name: string, symbol: string, minTokensOut: bigint): string {
  const nameTail = encodeStringTail(name);
  const symbolTail = encodeStringTail(symbol);
  // Head: 3 words — offset(name), offset(symbol), minTokensOut. Dynamic data
  // follows the 3-word (96-byte) head.
  const nameOffset = 96;
  const symbolOffset = nameOffset + nameTail.size;
  const head =
    encodeUint(BigInt(nameOffset)) +
    encodeUint(BigInt(symbolOffset)) +
    encodeUint(minTokensOut);
  return "0x" + WRITE_SELECTOR.createToken + head + nameTail.hex + symbolTail.hex;
}

/** buy(token, minTokensOut) calldata. `msg.value` (separate) is the ETH spent. */
export function encodeBuy(token: string, minTokensOut: bigint): string {
  return "0x" + WRITE_SELECTOR.buy + encodeAddress(token) + encodeUint(minTokensOut);
}

/** sell(token, tokenAmount, minEthOut) calldata (needs a prior ERC-20 approve). */
export function encodeSell(token: string, tokenAmount: bigint, minEthOut: bigint): string {
  return (
    "0x" +
    WRITE_SELECTOR.sell +
    encodeAddress(token) +
    encodeUint(tokenAmount) +
    encodeUint(minEthOut)
  );
}
