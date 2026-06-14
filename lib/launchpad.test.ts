import { describe, it, expect, afterEach } from "vitest";
import {
  parseProvider,
  parseCluster,
  providerLaunchpad,
  simulatedResult,
  launchpadConfigured,
  createToken,
} from "./launchpad";

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

  it("fails loudly when a real provider is selected without its key", async () => {
    process.env.LAUNCHPAD_PROVIDER = "pumpfun";
    delete process.env.PUMPPORTAL_API_KEY;
    expect(launchpadConfigured()).toBe(true);
    await expect(
      createToken({ name: "X", ticker: "TST", prompt: "p" })
    ).rejects.toThrow(/PUMPPORTAL_API_KEY/);
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
