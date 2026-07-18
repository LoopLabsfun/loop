import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCurveState } from "./hood";
import { curveToMarketStats } from "./hood-market";

const LAUNCHER = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x52908400098527886E0F7030069857D2E4169EE7";
const CREATOR = "0x8617E340B3D01FA5F11F306F4090FD50E238070D";

const ETHER = BigInt("1000000000000000000"); // 1e18 (ES2017 target: no `n` literals)
const ZERO = BigInt(0);
const ONE = BigInt(1);

/** ABI-encode a static-type word (uint/bool/address) right-aligned to 32 bytes. */
function w(v: bigint): string {
  return v.toString(16).padStart(64, "0");
}

/** Build the 8-word return blob of curves(address). */
function curvesBlob(o: {
  virtualEth: bigint;
  virtualTokens: bigint;
  realEth: bigint;
  target: bigint;
  feeBps: bigint;
  migrationBps: bigint;
  creator: string;
  migrated: boolean;
}): string {
  return (
    "0x" +
    w(o.virtualEth) +
    w(o.virtualTokens) +
    w(o.realEth) +
    w(o.target) +
    w(o.feeBps) +
    w(o.migrationBps) +
    w(BigInt(o.creator)) +
    w(o.migrated ? ONE : ZERO)
  );
}

function mockCall(result: string) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  } as Response);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_HOOD_LAUNCHER_ADDRESS = LAUNCHER;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_HOOD_LAUNCHER_ADDRESS;
});

describe("getCurveState", () => {
  it("decodes the curve struct and derives price/mcap/progress", async () => {
    // pump.fun-style deploy params, half-way to migration.
    const virtualEth = (BigInt(15) * ETHER) / BigInt(10); // 1.5 ETH
    const virtualTokens = BigInt(1_073_000_000) * ETHER;
    const realEth = (BigInt(2125) * ETHER) / BigInt(1000); // 2.125 ETH
    const target = (BigInt(425) * ETHER) / BigInt(100); // 4.25 ETH
    mockCall(
      curvesBlob({
        virtualEth,
        virtualTokens,
        realEth,
        target,
        feeBps: BigInt(100),
        migrationBps: BigInt(500),
        creator: CREATOR,
        migrated: false,
      })
    );

    const c = await getCurveState(TOKEN);
    expect(c).not.toBeNull();
    expect(c!.feeBps).toBe(100);
    expect(c!.migrationBps).toBe(500);
    expect(c!.migrated).toBe(false);
    expect(c!.creator.toLowerCase()).toBe(CREATOR.toLowerCase());
    // price = virtualEth/virtualTokens ≈ 1.5 / 1.073e9 ETH per token
    expect(c!.priceEth).toBeCloseTo(1.5 / 1_073_000_000, 18);
    // mcap = price × 1B supply ≈ 1.398 ETH
    expect(c!.marketCapEth).toBeCloseTo((1.5 / 1_073_000_000) * 1e9, 6);
    // progress = 2.125 / 4.25 = 0.5
    expect(c!.progress).toBeCloseTo(0.5, 9);
  });

  it("returns null for an unknown token (creator == 0)", async () => {
    mockCall(
      curvesBlob({
        virtualEth: ETHER,
        virtualTokens: ETHER,
        realEth: ZERO,
        target: ETHER,
        feeBps: ZERO,
        migrationBps: ZERO,
        creator: "0x0000000000000000000000000000000000000000",
        migrated: false,
      })
    );
    expect(await getCurveState(TOKEN)).toBeNull();
  });

  it("returns null when the launcher address isn't configured", async () => {
    delete process.env.NEXT_PUBLIC_HOOD_LAUNCHER_ADDRESS;
    const spy = mockCall("0x");
    expect(await getCurveState(TOKEN)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null on a short/garbage response", async () => {
    mockCall("0x1234");
    expect(await getCurveState(TOKEN)).toBeNull();
  });
});

describe("curveToMarketStats", () => {
  it("denominates in USD with priceNative in ETH and real graduation flag", () => {
    const curve = {
      virtualEth: (BigInt(15) * ETHER) / BigInt(10),
      virtualTokens: BigInt(1_073_000_000) * ETHER,
      realEth: (BigInt(425) * ETHER) / BigInt(100),
      target: (BigInt(425) * ETHER) / BigInt(100),
      feeBps: 100,
      migrationBps: 500,
      creator: CREATOR,
      migrated: true,
      priceEth: 1.5 / 1_073_000_000,
      marketCapEth: (1.5 / 1_073_000_000) * 1e9,
      progress: 1,
    };
    const stats = curveToMarketStats(curve, TOKEN, 3000);
    expect(stats.priceNative).toBeCloseTo(curve.priceEth, 18);
    expect(stats.priceUsd).toBeCloseTo(curve.priceEth * 3000, 12);
    expect(stats.marketCap).toBeCloseTo(curve.marketCapEth * 3000, 4);
    expect(stats.liquidityUsd).toBeCloseTo(4.25 * 3000, 4);
    expect(stats.graduated).toBe(true);
    expect(stats.pairAddress).toBe(TOKEN);
  });
});
