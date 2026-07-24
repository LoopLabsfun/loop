import { afterEach, describe, expect, it, vi } from "vitest";
import { PONS_FACTORY } from "./pons";

// verifyPonsLaunchTx is the trust boundary of the client-paid launch path: the
// browser hands over a transaction hash and nothing else. These cover the ways
// a caller could try to pass off something that isn't a Pons launch.
const TOKEN = "0x1234567890abcdef1234567890abcdef12345678";
const POOL = "0x85187610442415af3efd645ab6c55816cd1cd501";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
// Shape verified against a real on-chain launch (tx 0xf0bfbd92…f722c2):
// token/deployer/dexFactory are INDEXED, so the token is topics[1]; data is
// [pairToken, pool, dexId, …]. Reading data word 0 as the token yields WETH.
const TOKEN_LAUNCHED_TOPIC0 =
  "0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a";
const launchedLog = () => ({
  address: PONS_FACTORY,
  topics: [TOKEN_LAUNCHED_TOPIC0, "0x" + "0".repeat(24) + TOKEN.slice(2), "0x", "0x"],
  data:
    "0x" +
    "0".repeat(24) + WETH.slice(2) +
    "0".repeat(24) + POOL.slice(2) +
    "0".repeat(64 * 6),
});
const receipt = (over: Record<string, unknown> = {}) => ({
  status: "0x1",
  to: PONS_FACTORY,
  from: "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa",
  logs: [launchedLog()],
  ...over,
});

function mockRpc(result: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ result }) }) as unknown as Response)
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function verify(hash: string) {
  const { verifyPonsLaunchTx } = await import("./pons-launch");
  return verifyPonsLaunchTx(hash);
}

const HASH = "0x" + "ab".repeat(32);

describe("verifyPonsLaunchTx", () => {
  it("reads the token from topics[1] — NOT data word 0, which is WETH", async () => {
    mockRpc(receipt());
    const out = await verify(HASH);
    expect(out?.token.toLowerCase()).toBe(TOKEN.toLowerCase());
    expect(out?.token.toLowerCase()).not.toBe(WETH);
    expect(out?.from).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("also extracts the pool address (data word 1) for the market reader", async () => {
    mockRpc(receipt());
    expect((await verify(HASH))?.pool?.toLowerCase()).toBe(POOL);
  });

  it("refuses a REVERTED transaction", async () => {
    mockRpc(receipt({ status: "0x0" }));
    expect(await verify(HASH)).toBeNull();
  });

  it("refuses a transaction sent to some OTHER contract", async () => {
    // Otherwise any transfer at all would 'prove' a launch.
    mockRpc(receipt({ to: "0x000000000000000000000000000000000000dead" }));
    expect(await verify(HASH)).toBeNull();
  });

  it("refuses when no log comes from the factory", async () => {
    mockRpc(receipt({ logs: [{ ...launchedLog(), address: "0x000000000000000000000000000000000000dead" }] }));
    expect(await verify(HASH)).toBeNull();
  });

  it("refuses a factory log that isn't TokenLaunched", async () => {
    mockRpc(receipt({ logs: [{ ...launchedLog(), topics: ["0xdeadbeef", "0x" + "1".repeat(64)] }] }));
    expect(await verify(HASH)).toBeNull();
  });

  it("refuses a zero token address", async () => {
    mockRpc(receipt({ logs: [{ ...launchedLog(), topics: [TOKEN_LAUNCHED_TOPIC0, "0x" + "0".repeat(64)] }] }));
    expect(await verify(HASH)).toBeNull();
  });

  it("refuses a malformed hash without touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await verify("0xnope")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("decodeFeeWalletFromCalldata", () => {
  // Round-trip against the audited encoder: whatever feeWallet goes in must come
  // back out. This is the parameter that decides where every future trading fee
  // lands, and it is set once — so it is read back from the signed calldata
  // rather than trusted from a config file.
  const SALT = "0x" + "11".repeat(32);
  const CREATOR = "0x19513327024f3BA0B145846a96B459078E745091";

  it("recovers the feeWallet from real launchToken calldata", async () => {
    const { encodeLaunchToken } = await import("./pons");
    const { decodeFeeWalletFromCalldata } = await import("./pons-launch");
    const data = encodeLaunchToken(
      { name: "LOOP", symbol: "LOOP", description: "x", socials: { website: "https://looplabs.fun" }, feeWallet: CREATOR },
      { salt: SALT }
    );
    expect(decodeFeeWalletFromCalldata(data)?.toLowerCase()).toBe(CREATOR.toLowerCase());
  });

  it("distinguishes two different feeWallets — the whole point of the check", async () => {
    const { encodeLaunchToken } = await import("./pons");
    const { decodeFeeWalletFromCalldata } = await import("./pons-launch");
    const PLATFORM = "0x16c630FaFCa17eEd7F1368ef58D08FEAd0241B23";
    const a = encodeLaunchToken({ name: "A", symbol: "A", feeWallet: CREATOR }, { salt: SALT });
    const b = encodeLaunchToken({ name: "A", symbol: "A", feeWallet: PLATFORM }, { salt: SALT });
    expect(decodeFeeWalletFromCalldata(a)?.toLowerCase()).toBe(CREATOR.toLowerCase());
    expect(decodeFeeWalletFromCalldata(b)?.toLowerCase()).toBe(PLATFORM.toLowerCase());
  });

  it("returns null for a zero feeWallet (Pons would fall back to msg.sender)", async () => {
    const { encodeLaunchToken } = await import("./pons");
    const { decodeFeeWalletFromCalldata } = await import("./pons-launch");
    const z = encodeLaunchToken({ name: "A", symbol: "A" }, { salt: SALT });
    expect(decodeFeeWalletFromCalldata(z)).toBeNull();
  });

  it("returns null for calldata that isn't launchToken", async () => {
    const { decodeFeeWalletFromCalldata } = await import("./pons-launch");
    expect(decodeFeeWalletFromCalldata("0xdeadbeef")).toBeNull();
    expect(decodeFeeWalletFromCalldata("")).toBeNull();
  });
});
