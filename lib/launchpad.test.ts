import { describe, it, expect, afterEach } from "vitest";
import { parseProvider, parseCluster, providerLaunchpad, simulatedResult, launchpadConfigured, createToken, providerForChain } from "./launchpad";

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
});

describe("parseProvider", () => {
  it("accepts known providers", () => {
    expect(parseProvider("spl")).toBe("spl");
    expect(parseProvider("pumpfun")).toBe("pumpfun");
    expect(parseProvider("bags")).toBe("bags");
  });
  it("defaults to simulated for unknown / unset", () => {
    expect(parseProvider(undefined)).toBe("simulated");
    expect(parseProvider("")).toBe("simulated");
    expect(parseProvider("nope")).toBe("simulated");
  });
});

describe("parseCluster", () => {
  it("only devnet selects devnet", () => {
    expect(parseCluster("devnet")).toBe("devnet");
    expect(parseCluster("mainnet")).toBe("mainnet");
    expect(parseCluster(undefined)).toBe("mainnet");
  });
});

describe("providerLaunchpad", () => {
  it("maps providers to display launchpads", () => {
    expect(providerLaunchpad("pumpfun")).toBe("Pump.fun");
    expect(providerLaunchpad("bags")).toBe("Bags.fun");
    expect(providerLaunchpad("simulated")).toBe("Pump.fun");
    expect(providerLaunchpad("spl")).toBe("Pump.fun");
  });
});

describe("simulatedResult", () => {
  it("never returns a mint or treasury wallet", () => {
    const r = simulatedResult("simulated", "mainnet");
    expect(r.mint).toBeNull();
    expect(r.treasuryWallet).toBeNull();
    expect(r.simulated).toBe(true);
    expect(r.cluster).toBe("mainnet");
  });
});

describe("createToken", () => {
  it("runs in simulated mode by default (no mint, RLS-safe)", async () => {
    delete process.env.LAUNCHPAD_PROVIDER;
    const r = await createToken({ name: "X", ticker: "TST", prompt: "p" });
    expect(r.simulated).toBe(true);
    expect(r.mint).toBeNull();
    expect(r.treasuryWallet).toBeNull();
    expect(launchpadConfigured()).toBe(false);
  });

  it("pump.fun launch requires the creator signer", async () => {
    process.env.LAUNCHPAD_PROVIDER = "pumpfun";
    delete process.env.LAUNCH_SIGNER_SECRET; // non-custodial Local flow signs locally
    expect(launchpadConfigured()).toBe(true);
    await expect(
      createToken({ name: "X", ticker: "TST", prompt: "p" })
    ).rejects.toThrow(/LAUNCH_SIGNER_SECRET/);
  });

  it("spl provider requires LAUNCH_SIGNER_SECRET", async () => {
    process.env.LAUNCHPAD_PROVIDER = "spl";
    delete process.env.LAUNCH_SIGNER_SECRET;
    expect(launchpadConfigured()).toBe(true);
    await expect(
      createToken({ name: "X", ticker: "TST", prompt: "p" })
    ).rejects.toThrow(/LAUNCH_SIGNER_SECRET/);
  });

  it("input cluster overrides the env cluster", async () => {
    process.env.LAUNCHPAD_PROVIDER = "";
    process.env.LAUNCH_CLUSTER = "mainnet";
    const r = await createToken({
      name: "X",
      ticker: "TST",
      prompt: "p",
      cluster: "devnet",
    });
    expect(r.cluster).toBe("devnet");
  });

  it("respects the configured cluster", async () => {
    process.env.LAUNCHPAD_PROVIDER = "";
    process.env.LAUNCH_CLUSTER = "devnet";
    const r = await createToken({ name: "X", ticker: "TST", prompt: "p" });
    expect(r.cluster).toBe("devnet");
  });
});

describe("providerForChain — Solana and Hood arm independently", () => {
  it("reads the Solana provider from LAUNCHPAD_PROVIDER", () => {
    expect(providerForChain("solana", { LAUNCHPAD_PROVIDER: "pumpfun" })).toBe("pumpfun");
  });

  it("defaults Hood to pons even when nothing is set for it", () => {
    expect(providerForChain("hood", {})).toBe("pons");
  });

  it("arming Solana does NOT disarm Hood (the whole point)", () => {
    const env = { LAUNCHPAD_PROVIDER: "pumpfun" };
    expect(providerForChain("solana", env)).toBe("pumpfun");
    expect(providerForChain("hood", env)).toBe("pons");
  });

  it("arming Hood does NOT change Solana", () => {
    const env = { LAUNCHPAD_PROVIDER: "pumpfun", LAUNCHPAD_PROVIDER_HOOD: "pons" };
    expect(providerForChain("solana", env)).toBe("pumpfun");
    expect(providerForChain("hood", env)).toBe("pons");
  });

  it("refuses a Solana provider for a Hood launch — never mints on the wrong chain", () => {
    expect(providerForChain("hood", { LAUNCHPAD_PROVIDER_HOOD: "pumpfun" })).toBe("simulated");
  });

  it("refuses a Hood provider for a Solana launch", () => {
    expect(providerForChain("solana", { LAUNCHPAD_PROVIDER: "pons" })).toBe("simulated");
  });

  it("unset Solana provider stays simulated (untouched by the Hood default)", () => {
    expect(providerForChain("solana", {})).toBe("simulated");
  });

  it("an explicitly disabled Hood provider is simulated, not the pons default", () => {
    expect(providerForChain("hood", { LAUNCHPAD_PROVIDER_HOOD: "simulated" })).toBe("simulated");
  });
});
