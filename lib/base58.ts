// Minimal, dependency-free Base58 (Bitcoin alphabet) codec. We avoid the `bs58`
// package because its current major is ESM-only and trips Next/Vercel's
// ERR_REQUIRE_ESM on the server path (same class of bug as @solana/web3.js).

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) MAP[ALPHABET[i]] = i;

export function base58Decode(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array();
  const bytes: number[] = [0];
  for (const ch of input) {
    const value = MAP[ch];
    if (value === undefined) throw new Error(`Invalid base58 character: ${ch}`);
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Account for leading zero bytes (encoded as '1').
  for (let k = 0; k < input.length && input[k] === "1"; k++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits: number[] = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (let k = 0; k < bytes.length && bytes[k] === 0; k++) out += "1";
  for (let q = digits.length - 1; q >= 0; q--) out += ALPHABET[digits[q]];
  return out;
}
