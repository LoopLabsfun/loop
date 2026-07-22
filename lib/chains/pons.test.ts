import { describe, expect, it } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  encodeLaunchToken,
  isSalt,
  launchValueWei,
  PONS_LAUNCH_FEE_WEI,
  PONS_SELECTORS,
  PONS_SIGNATURES,
} from "./pons";

// Reference calldata produced by foundry:
//   cast calldata "launchToken((string,string,string,string,(string,string,string,string,string),address),uint256,uint256,bytes32)" \
//     '("LOOP","LOOP","https://looplabs.fun/logo.png","An autonomous software factory.",("https://x.com/looplabs_fun","https://t.me/looplabs_fun","","https://looplabs.fun",""),0x16c630FaFCa17eEd7F1368ef58D08FEAd0241B23)' \
//     0 0 0x00000000000000000000000000000000000000000000000000000000000000ff
// A nested dynamic tuple is exactly the encoding that looks right and isn't, so
// this is asserted against a real encoder rather than against my own reasoning.
const CAST_REFERENCE =
  "0x686399cb00000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ff00000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000018000000000000000000000000000000000000000000000000000000000000001c000000000000000000000000016c630fafca17eed7f1368ef58d08fead0241b2300000000000000000000000000000000000000000000000000000000000000044c4f4f500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044c4f4f5000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001d68747470733a2f2f6c6f6f706c6162732e66756e2f6c6f676f2e706e67000000000000000000000000000000000000000000000000000000000000000000001f416e206175746f6e6f6d6f757320736f66747761726520666163746f72792e0000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000180000000000000000000000000000000000000000000000000000000000000001a68747470733a2f2f782e636f6d2f6c6f6f706c6162735f66756e000000000000000000000000000000000000000000000000000000000000000000000000001968747470733a2f2f742e6d652f6c6f6f706c6162735f66756e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001468747470733a2f2f6c6f6f706c6162732e66756e0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

const SALT = "0x00000000000000000000000000000000000000000000000000000000000000ff";

const sel = (sig: string) =>
  Buffer.from(keccak_256(new TextEncoder().encode(sig))).toString("hex").slice(0, 8);

describe("PONS selectors", () => {
  it("every hardcoded selector is the keccak of its signature", () => {
    // This check caught two wrong constants the first time it ran.
    expect(sel(PONS_SIGNATURES.launchToken)).toBe(PONS_SELECTORS.launchToken);
    expect(sel(PONS_SIGNATURES.launchFee)).toBe(PONS_SELECTORS.launchFee);
    expect(sel(PONS_SIGNATURES.launchEnabled)).toBe(PONS_SELECTORS.launchEnabled);
  });
});

describe("encodeLaunchToken", () => {
  it("matches `cast calldata` byte for byte", () => {
    const got = encodeLaunchToken(
      {
        name: "LOOP",
        symbol: "LOOP",
        logo: "https://looplabs.fun/logo.png",
        description: "An autonomous software factory.",
        socials: {
          twitter: "https://x.com/looplabs_fun",
          telegram: "https://t.me/looplabs_fun",
          discord: "",
          website: "https://looplabs.fun",
          farcaster: "",
        },
        feeWallet: "0x16c630FaFCa17eEd7F1368ef58D08FEAd0241B23",
      },
      { launchConfigId: 0, dexId: 0, salt: SALT }
    );
    expect(got.toLowerCase()).toBe(CAST_REFERENCE.toLowerCase());
  });

  it("starts with the launchToken selector", () => {
    const got = encodeLaunchToken({ name: "A", symbol: "A" }, { salt: SALT });
    expect(got.startsWith("0x" + PONS_SELECTORS.launchToken)).toBe(true);
  });

  it("encodes to whole 32-byte words", () => {
    const got = encodeLaunchToken({ name: "Loop Project", symbol: "LOOP" }, { salt: SALT });
    expect((got.length - 10) % 64).toBe(0);
  });

  it("omitting socials/logo/description is valid (empty strings, not undefined)", () => {
    const bare = encodeLaunchToken({ name: "A", symbol: "B" }, { salt: SALT });
    const explicit = encodeLaunchToken(
      { name: "A", symbol: "B", logo: "", description: "", socials: {} },
      { salt: SALT }
    );
    expect(bare).toBe(explicit);
  });

  it("defaults feeWallet to the zero address (contract falls back to msg.sender)", () => {
    const got = encodeLaunchToken({ name: "A", symbol: "B" }, { salt: SALT });
    const withZero = encodeLaunchToken(
      { name: "A", symbol: "B", feeWallet: "0x0000000000000000000000000000000000000000" },
      { salt: SALT }
    );
    expect(got).toBe(withZero);
  });

  it("handles multi-byte UTF-8 without breaking word alignment", () => {
    const got = encodeLaunchToken({ name: "Bâtisseur 🚀", symbol: "BÂT" }, { salt: SALT });
    expect((got.length - 10) % 64).toBe(0);
  });

  it("refuses an empty name or symbol — the contract would revert", () => {
    expect(() => encodeLaunchToken({ name: "", symbol: "B" }, { salt: SALT })).toThrow();
    expect(() => encodeLaunchToken({ name: "A", symbol: "" }, { salt: SALT })).toThrow();
  });

  it("refuses a malformed salt rather than sending a wrong CREATE2 address", () => {
    expect(() => encodeLaunchToken({ name: "A", symbol: "B" }, { salt: "0xff" })).toThrow();
    expect(() => encodeLaunchToken({ name: "A", symbol: "B" }, { salt: "" })).toThrow();
  });

  it("a different salt changes the calldata (and so the token address)", () => {
    const a = encodeLaunchToken({ name: "A", symbol: "B" }, { salt: SALT });
    const b = encodeLaunchToken(
      { name: "A", symbol: "B" },
      { salt: "0x" + "00".repeat(31) + "fe" }
    );
    expect(a).not.toBe(b);
  });
});

describe("launchValueWei", () => {
  it("is the fee plus the dev buy — the excess IS the dev buy", () => {
    expect(launchValueWei(PONS_LAUNCH_FEE_WEI, BigInt(0))).toBe(PONS_LAUNCH_FEE_WEI);
    expect(launchValueWei(PONS_LAUNCH_FEE_WEI, BigInt("100000000000000000"))).toBe(
      PONS_LAUNCH_FEE_WEI + BigInt("100000000000000000")
    );
  });
  it("refuses negatives", () => {
    expect(() => launchValueWei(BigInt(-1), BigInt(0))).toThrow();
    expect(() => launchValueWei(BigInt(0), BigInt(-1))).toThrow();
  });
});

describe("isSalt", () => {
  it("accepts 32 bytes of hex, rejects anything else", () => {
    expect(isSalt(SALT)).toBe(true);
    expect(isSalt("0x" + "ab".repeat(32))).toBe(true);
    expect(isSalt("0x" + "ab".repeat(31))).toBe(false);
    expect(isSalt("ab".repeat(32))).toBe(false);
  });
});
