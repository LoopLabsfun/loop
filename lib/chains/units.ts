// Decimal-string ↔ base-unit (wei) conversion without floating point, for the
// EVM trading UI. parseUnits("0.05", 18) → 50000000000000000n. Pure + tested.

/** 10^n as a bigint (ES2017 target: no `**` on bigint). */
function pow10(n: number): bigint {
  let r = BigInt(1);
  for (let i = 0; i < n; i++) r *= BigInt(10);
  return r;
}

/** Parse a decimal string into base units for `decimals`, or null on bad input. */
export function parseUnits(value: string, decimals = 18): bigint | null {
  const v = value.trim();
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  const [whole, frac = ""] = v.split(".");
  if (frac.length > decimals) return null; // more precision than the token has
  const padded = frac.padEnd(decimals, "0");
  try {
    return BigInt(whole || "0") * pow10(decimals) + BigInt(padded || "0");
  } catch {
    return null;
  }
}

/** Format base units to a human decimal string with up to `maxFrac` places. */
export function formatUnits(v: bigint, decimals = 18, maxFrac = 6): string {
  const base = pow10(decimals);
  const whole = v / base;
  const frac = v % base;
  if (frac === BigInt(0)) return whole.toString();
  let fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFrac);
  fracStr = fracStr.replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
