import { afterEach, describe, expect, it, vi } from "vitest";

import { getErc20Balance, getEthBalance, hexToUi } from "./hood";

const EVM_ADDR = "0x52908400098527886E0F7030069857D2E4169EE7";
const TOKEN = "0x8617E340B3D01FA5F11F306F4090FD50E238070D";

function mockRpcResult(result: unknown, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

describe("hexToUi", () => {
  it("converts wei hex to ETH", () => {
    expect(hexToUi("0xde0b6b3a7640000", 18)).toBe(1); // 1e18 wei
    expect(hexToUi("0x0", 18)).toBe(0);
    expect(hexToUi("0x2386f26fc10000", 18)).toBeCloseTo(0.01, 12);
  });

  it("rejects junk", () => {
    expect(hexToUi("nope", 18)).toBe(null);
    expect(hexToUi("0xZZ", 18)).toBe(null);
  });
});

describe("getEthBalance", () => {
  it("reads a balance via eth_getBalance", async () => {
    const spy = mockRpcResult("0x1bc16d674ec80000"); // 2 ETH
    await expect(getEthBalance(EVM_ADDR)).resolves.toBe(2);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.method).toBe("eth_getBalance");
    expect(body.params[0]).toBe(EVM_ADDR);
  });

  it("returns null on a non-EVM address without calling the RPC", async () => {
    const spy = mockRpcResult("0x0");
    await expect(getEthBalance("So11111111111111111111111111111111111111112")).resolves.toBe(null);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null on RPC failure (callers keep the snapshot)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    await expect(getEthBalance(EVM_ADDR)).resolves.toBe(null);
  });
});

describe("getErc20Balance", () => {
  it("reads balanceOf via eth_call with the padded owner", async () => {
    const spy = mockRpcResult(
      "0x00000000000000000000000000000000000000000000003635c9adc5dea00000" // 1000e18
    );
    await expect(getErc20Balance(EVM_ADDR, TOKEN)).resolves.toBe(1000);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.method).toBe("eth_call");
    expect(body.params[0].to).toBe(TOKEN);
    expect(body.params[0].data).toBe(
      "0x70a08231" + "0".repeat(24) + EVM_ADDR.slice(2).toLowerCase()
    );
  });
});
