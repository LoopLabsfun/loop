import { describe, expect, it } from "vitest";
import {
  buildEvmLinkMessage,
  EVM_LINK_MAX_AGE_MS,
  isEvmAddress,
  isFreshLinkTs,
  linkProofProblems,
  normalizeEvmAddress,
  buildEvmSignInMessage,
  signInProofProblems,
} from "./evm-link-message";

const WALLET = "7kyekHMcBuyMTz7xobZimbSrxNKJhJTZzWApri2tcmm9";
const EVM = "0x16c630FaFCa17eEd7F1368ef58D08FEAd0241B23";
const NOW = 1_800_000_000_000;

describe("buildEvmLinkMessage", () => {
  it("binds the EVM address to the Solana wallet and a timestamp", () => {
    expect(buildEvmLinkMessage(WALLET, EVM, NOW)).toBe(
      `looplabs.fun link evm\nwallet:${WALLET}\nevm:${EVM.toLowerCase()}\nts:${NOW}`
    );
  });

  it("is casing-stable — a checksummed and a lowercase address sign the same text", () => {
    expect(buildEvmLinkMessage(WALLET, EVM, NOW)).toBe(
      buildEvmLinkMessage(WALLET, EVM.toLowerCase(), NOW)
    );
  });

  it("differs per Solana wallet, so a signature can't be replayed onto another profile", () => {
    expect(buildEvmLinkMessage(WALLET, EVM, NOW)).not.toBe(
      buildEvmLinkMessage("SomeOtherWallet111", EVM, NOW)
    );
  });
});

describe("isEvmAddress", () => {
  it("accepts a 20-byte 0x address in any casing", () => {
    expect(isEvmAddress(EVM)).toBe(true);
    expect(isEvmAddress(EVM.toLowerCase())).toBe(true);
  });
  it("rejects the near-misses that lose funds", () => {
    expect(isEvmAddress(EVM.slice(0, -1))).toBe(false); // one char short
    expect(isEvmAddress(EVM + "0")).toBe(false); // one char long
    expect(isEvmAddress(EVM.slice(2))).toBe(false); // no 0x
    expect(isEvmAddress("0xZZc630FaFCa17eEd7F1368ef58D08FEAd0241B23")).toBe(false);
    expect(isEvmAddress(WALLET)).toBe(false); // a Solana address
    expect(isEvmAddress(null)).toBe(false);
  });
});

describe("normalizeEvmAddress", () => {
  it("gives one canonical spelling", () => {
    expect(normalizeEvmAddress(`  ${EVM}  `)).toBe(EVM.toLowerCase());
  });
});

describe("isFreshLinkTs", () => {
  it("accepts a just-signed proof", () => {
    expect(isFreshLinkTs(NOW, NOW)).toBe(true);
    expect(isFreshLinkTs(NOW - 60_000, NOW)).toBe(true);
  });
  it("rejects a stale proof", () => {
    expect(isFreshLinkTs(NOW - EVM_LINK_MAX_AGE_MS - 1, NOW)).toBe(false);
  });
  it("tolerates small clock skew but not a far-future timestamp", () => {
    expect(isFreshLinkTs(NOW + 30_000, NOW)).toBe(true);
    expect(isFreshLinkTs(NOW + 10 * 60_000, NOW)).toBe(false);
  });
  it("rejects nonsense", () => {
    expect(isFreshLinkTs(NaN, NOW)).toBe(false);
  });
});

describe("linkProofProblems", () => {
  const proof = { address: EVM, signature: "0x" + "ab".repeat(65), ts: NOW };
  const msg = buildEvmLinkMessage(WALLET, EVM, NOW);

  it("passes a well-formed, fresh, matching proof", () => {
    expect(linkProofProblems(WALLET, proof, msg, NOW)).toBeNull();
  });

  it("refuses a message the caller chose rather than the one we would build", () => {
    expect(linkProofProblems(WALLET, proof, "gm", NOW)).toBe(
      "signed message does not match this wallet and address"
    );
  });

  it("refuses a proof whose message points at a DIFFERENT EVM address", () => {
    // The attack: sign for an address you control, submit someone else's.
    const other = "0x000000000000000000000000000000000000dead";
    expect(linkProofProblems(WALLET, { ...proof, address: other }, msg, NOW)).toBe(
      "signed message does not match this wallet and address"
    );
  });

  it("refuses a proof minted for another Solana wallet", () => {
    expect(linkProofProblems("OtherWallet1111", proof, msg, NOW)).toBe(
      "signed message does not match this wallet and address"
    );
  });

  it("refuses an expired proof", () => {
    expect(linkProofProblems(WALLET, proof, msg, NOW + EVM_LINK_MAX_AGE_MS + 1)).toBe(
      "proof expired — sign again"
    );
  });

  it("refuses a malformed address before anything else", () => {
    expect(linkProofProblems(WALLET, { ...proof, address: "0xnope" }, msg, NOW)).toBe(
      "invalid EVM address"
    );
  });

  it("refuses a missing signature", () => {
    expect(linkProofProblems(WALLET, { ...proof, signature: "" }, msg, NOW)).toBe(
      "missing signature"
    );
  });
});

describe("buildEvmSignInMessage", () => {
  it("uses a namespace DISTINCT from linking — one signature can't do both", () => {
    const link = buildEvmLinkMessage(WALLET, EVM, NOW);
    const signIn = buildEvmSignInMessage(EVM, NOW);
    expect(signIn).not.toBe(link);
    expect(signIn.startsWith("looplabs.fun sign in")).toBe(true);
    expect(link.startsWith("looplabs.fun link evm")).toBe(true);
  });

  it("carries no Solana wallet — the server resolves it from the proven link", () => {
    expect(buildEvmSignInMessage(EVM, NOW)).toBe(
      `looplabs.fun sign in\nevm:${EVM.toLowerCase()}\nts:${NOW}`
    );
  });
});

describe("signInProofProblems", () => {
  const proof = { address: EVM, signature: "0x" + "ab".repeat(65), ts: NOW };

  it("passes a fresh, well-formed proof", () => {
    expect(signInProofProblems(proof, buildEvmSignInMessage(EVM, NOW), NOW)).toBeNull();
  });

  it("refuses a LINK signature replayed as a sign-in", () => {
    const linkMsg = buildEvmLinkMessage(WALLET, EVM, NOW);
    expect(signInProofProblems(proof, linkMsg, NOW)).toBe(
      "signed message does not match this address"
    );
  });

  it("refuses a proof minted for a different address", () => {
    const other = "0x000000000000000000000000000000000000dead";
    expect(signInProofProblems({ ...proof, address: other }, buildEvmSignInMessage(EVM, NOW), NOW)).toBe(
      "signed message does not match this address"
    );
  });

  it("refuses an expired proof", () => {
    expect(
      signInProofProblems(proof, buildEvmSignInMessage(EVM, NOW), NOW + EVM_LINK_MAX_AGE_MS + 1)
    ).toBe("proof expired — sign again");
  });
});
