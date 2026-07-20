import { describe, it, expect } from "vitest";
import {
  isSvmTx,
  isEvmTx,
  toEthSendParams,
  hexToBytes,
  firstDeposit,
  requestIdFromSteps,
  type RelayStep,
} from "./relay-execute";

// Captured from live api.relay.link/quote/v2 responses.
const SVM_STEP: RelayStep = {
  id: "deposit",
  kind: "transaction",
  items: [
    {
      status: "incomplete",
      data: {
        instructions: [
          {
            keys: [{ pubkey: "Dodg2HifwU8rmaVVyMyUZDGTRbqAJTyVYxXPwcbNpBKc", isSigner: false, isWritable: false }],
            programId: "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2",
            data: "0d9e0ddf5fd51c06",
          },
        ],
        addressLookupTableAddresses: ["Hm9fUgcn7qwDaiNTFiGh6pNtVATgnaRcmK6Bbx6EMZfP"],
      },
      check: { endpoint: "/intents/status/v3?requestId=0xd2e042a3924184cd", method: "GET" },
    },
  ],
};

const EVM_STEP: RelayStep = {
  id: "deposit",
  kind: "transaction",
  items: [
    {
      status: "incomplete",
      data: {
        from: "0x16c630FaFCa17eEd7F1368ef58D08FEAd0241B23",
        to: "0x4cd00e387622c35bddb9b4c962c136462338bc31",
        data: "0x49290c1c0000",
        value: "4000000000000000",
        chainId: 4663,
        gas: "35525",
      },
      check: { endpoint: "/intents/status/v3?requestId=0xabc123", method: "GET" },
    },
  ],
};

describe("relay step classification", () => {
  it("detects SVM vs EVM payloads", () => {
    expect(isSvmTx(SVM_STEP.items[0].data)).toBe(true);
    expect(isEvmTx(SVM_STEP.items[0].data)).toBe(false);
    expect(isEvmTx(EVM_STEP.items[0].data)).toBe(true);
    expect(isSvmTx(EVM_STEP.items[0].data)).toBe(false);
  });
  it("firstDeposit finds the executable item", () => {
    expect(firstDeposit([SVM_STEP])).toBe(SVM_STEP.items[0]);
    expect(firstDeposit([{ id: "x", kind: "transaction", items: [] }])).toBeNull();
  });
});

describe("EVM tx mapping", () => {
  it("maps to eth_sendTransaction params with hex value/gas", () => {
    const p = toEthSendParams(EVM_STEP.items[0].data as never);
    expect(p.from).toBe("0x16c630FaFCa17eEd7F1368ef58D08FEAd0241B23");
    expect(p.to).toBe("0x4cd00e387622c35bddb9b4c962c136462338bc31");
    expect(p.value).toBe("0x" + BigInt("4000000000000000").toString(16));
    expect(p.gas).toBe("0x" + BigInt("35525").toString(16));
  });
  it("omits a zero value (plain call)", () => {
    const p = toEthSendParams({ from: "0xa", to: "0xb", data: "0x", value: "0" });
    expect("value" in p).toBe(false);
  });
});

describe("hex decode", () => {
  it("decodes instruction data bytes", () => {
    expect(Array.from(hexToBytes("0d9e0d"))).toEqual([0x0d, 0x9e, 0x0d]);
    expect(Array.from(hexToBytes("0x0d9e"))).toEqual([0x0d, 0x9e]);
  });
  it("returns empty on malformed hex", () => {
    expect(hexToBytes("xyz").length).toBe(0);
    expect(hexToBytes("abc").length).toBe(0); // odd length
  });
});

describe("requestId extraction", () => {
  it("pulls the requestId from the check endpoint", () => {
    expect(requestIdFromSteps([SVM_STEP])).toBe("0xd2e042a3924184cd");
    expect(requestIdFromSteps([EVM_STEP])).toBe("0xabc123");
  });
  it("returns null when absent", () => {
    expect(requestIdFromSteps([{ id: "x", kind: "transaction", items: [{ data: {} }] }])).toBeNull();
  });
});
