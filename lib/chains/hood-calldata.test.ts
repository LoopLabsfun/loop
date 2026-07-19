import { describe, expect, it } from "vitest";

import {
  encodeBuy,
  encodeCreateToken,
  encodeSell,
  encodeAddress,
  encodeUint,
} from "./hood-calldata";

const TOKEN = "0x52908400098527886E0F7030069857D2E4169EE7";

// Reference calldata from `cast calldata` against the HoodLauncher signatures —
// pasted verbatim (single string) so there's no hand-split error; the encoder
// must reproduce it byte-for-byte.
const REF_CREATE =
  "0x5b060530000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b4f70656e20437572736f7200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000054f53435552000000000000000000000000000000000000000000000000000000";
const REF_BUY =
  "0xcce7ec1300000000000000000000000052908400098527886e0f7030069857d2e4169ee7000000000000000000000000000000000000000000000000000000000000007b";
const REF_SELL =
  "0x6a27246200000000000000000000000052908400098527886e0f7030069857d2e4169ee700000000000000000000000000000000000000000000003635c9adc5dea0000000000000000000000000000000000000000000000000000006f05b59d3b20000";

describe("hood calldata encoder (vs cast)", () => {
  it("createToken(string,string,uint256)", () => {
    expect(encodeCreateToken("Open Cursor", "OSCUR", BigInt(0))).toBe(REF_CREATE);
  });

  it("buy(address,uint256)", () => {
    expect(encodeBuy(TOKEN, BigInt(123))).toBe(REF_BUY);
  });

  it("sell(address,uint256,uint256)", () => {
    expect(
      encodeSell(TOKEN, BigInt("1000000000000000000000"), BigInt("500000000000000000"))
    ).toBe(REF_SELL);
  });

  it("primitives", () => {
    expect(encodeUint(BigInt(0))).toBe("0".repeat(64));
    expect(encodeAddress(TOKEN)).toBe(
      "00000000000000000000000052908400098527886e0f7030069857d2e4169ee7"
    );
    expect(() => encodeAddress("0x123")).toThrow();
    expect(() => encodeUint(BigInt(-1))).toThrow();
  });
});
