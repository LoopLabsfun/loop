import { afterEach, describe, expect, it, vi } from "vitest";
import { PONS_FACTORY } from "./pons";

// verifyPonsLaunchTx is the trust boundary of the client-paid launch path: the
// browser hands over a transaction hash and nothing else. These cover the ways
// a caller could try to pass off something that isn't a Pons launch.
const TOKEN = "0x1234567890abcdef1234567890abcdef12345678";
const receipt = (over: Record<string, unknown> = {}) => ({
  status: "0x1",
  to: PONS_FACTORY,
  from: "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa",
  logs: [{ address: PONS_FACTORY, data: "0x" + "0".repeat(24) + TOKEN.slice(2), topics: [] }],
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
  it("accepts a successful launch and reads the token from the factory's log", async () => {
    mockRpc(receipt());
    const out = await verify(HASH);
    expect(out?.token.toLowerCase()).toBe(TOKEN.toLowerCase());
    expect(out?.from).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
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
    mockRpc(
      receipt({
        logs: [{ address: "0x000000000000000000000000000000000000dead", data: "0x" + "1".repeat(64), topics: [] }],
      })
    );
    expect(await verify(HASH)).toBeNull();
  });

  it("refuses a zero token address", async () => {
    mockRpc(receipt({ logs: [{ address: PONS_FACTORY, data: "0x" + "0".repeat(64), topics: [] }] }));
    expect(await verify(HASH)).toBeNull();
  });

  it("refuses a malformed hash without touching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await verify("0xnope")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
