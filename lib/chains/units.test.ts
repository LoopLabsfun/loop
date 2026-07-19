import { describe, expect, it } from "vitest";

import { formatUnits, parseUnits } from "./units";

describe("parseUnits", () => {
  it("parses decimals into base units without float error", () => {
    expect(parseUnits("1", 18)).toBe(BigInt("1000000000000000000"));
    expect(parseUnits("0.05", 18)).toBe(BigInt("50000000000000000"));
    expect(parseUnits("0.000000000000000001", 18)).toBe(BigInt(1));
    expect(parseUnits("123.456", 18)).toBe(BigInt("123456000000000000000"));
    expect(parseUnits("", 18)).toBeNull();
    expect(parseUnits(".", 18)).toBeNull();
    expect(parseUnits("1.2.3", 18)).toBeNull();
    expect(parseUnits("abc", 18)).toBeNull();
    // more precision than the token supports
    expect(parseUnits("0.1234567", 6)).toBeNull();
  });
});

describe("formatUnits", () => {
  it("formats base units back to a trimmed decimal string", () => {
    expect(formatUnits(BigInt("1000000000000000000"), 18)).toBe("1");
    expect(formatUnits(BigInt("50000000000000000"), 18)).toBe("0.05");
    expect(formatUnits(BigInt("1234500000000000000"), 18, 6)).toBe("1.2345");
    expect(formatUnits(BigInt(0), 18)).toBe("0");
  });
});
