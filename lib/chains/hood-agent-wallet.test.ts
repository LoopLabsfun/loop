import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getHoodAgentWallet,
  hoodWalletExternalId,
  privySendEvmTx,
} from "./hood-agent-wallet";

const ORIG = { ...process.env };
afterEach(() => {
  process.env = { ...ORIG };
  vi.restoreAllMocks();
});

describe("hoodWalletExternalId", () => {
  it("is deterministic, hood-scoped, and ≤ 64 chars", () => {
    expect(hoodWalletExternalId("loop")).toBe("loop-agent-hood-loop");
    // distinct from the Solana external_id namespace
    expect(hoodWalletExternalId("loop")).not.toBe("loop-agent-loop");
    expect(hoodWalletExternalId("x".repeat(100)).length).toBeLessThanOrEqual(64);
  });
});

describe("getHoodAgentWallet", () => {
  it("returns null when Privy custody isn't configured (no fetch)", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await getHoodAgentWallet("loop")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("privySendEvmTx", () => {
  it("posts an eth_sendTransaction with the Hood caip2 + hex value", async () => {
    process.env.PRIVY_APP_ID = "app";
    process.env.PRIVY_APP_SECRET = "sec";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: { hash: "0xabc" } }),
    } as Response);

    const hash = await privySendEvmTx("wid", {
      to: "0x52908400098527886E0F7030069857D2E4169EE7",
      valueWei: BigInt("1000000000000000000"), // 1 ETH
    });
    expect(hash).toBe("0xabc");

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain("/wallets/wid/rpc");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.method).toBe("eth_sendTransaction");
    expect(body.caip2).toBe("eip155:4663");
    expect(body.params.transaction.chain_id).toBe(4663);
    expect(body.params.transaction.value).toBe("0xde0b6b3a7640000"); // 1e18 hex
  });

  it("throws (does not silently succeed) when custody isn't configured", async () => {
    delete process.env.PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    await expect(
      privySendEvmTx("wid", { to: "0x52908400098527886E0F7030069857D2E4169EE7" })
    ).rejects.toThrow(/not configured/i);
  });
});
