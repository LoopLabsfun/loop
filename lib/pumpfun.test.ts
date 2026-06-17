import { describe, it, expect } from "vitest";
import { buildCreatePayload } from "./pumpfun";

describe("buildCreatePayload", () => {
  const p = buildCreatePayload({
    publicKey: "Signer1111111111111111111111111111111111111",
    mint: "Mint111111111111111111111111111111111111Loop",
    metadataUri: "https://ipfs/meta.json",
    name: "Devnet Demo",
    symbol: "DEMO",
  });

  it("is a pump.fun create on the pump pool", () => {
    expect(p.action).toBe("create");
    expect(p.pool).toBe("pump");
    expect(p.denominatedInSol).toBe("true");
    expect(p.amount).toBe(0); // no dev-buy
  });

  it("carries the vanity mint + metadata + creator", () => {
    expect(p.mint.endsWith("Loop")).toBe(true);
    expect(p.tokenMetadata).toEqual({
      name: "Devnet Demo",
      symbol: "DEMO",
      uri: "https://ipfs/meta.json",
    });
    expect(p.publicKey).toContain("Signer");
  });

  it("sets the dev-buy amount (SOL) when given, clamped non-negative", () => {
    const base = {
      publicKey: "S",
      mint: "MLoop",
      metadataUri: "u",
      name: "n",
      symbol: "s",
    };
    expect(buildCreatePayload({ ...base, amountSol: 0.2 }).amount).toBe(0.2);
    expect(buildCreatePayload({ ...base, amountSol: -5 }).amount).toBe(0);
    expect(buildCreatePayload(base).amount).toBe(0); // default: no dev-buy
  });
});
