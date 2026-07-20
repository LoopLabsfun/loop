import { describe, it, expect } from "vitest";
import {
  TRADE_TOPIC0,
  addressTopic,
  addressFromTopic,
  decodeTradeLog,
  fmtUnits,
  formatBuyAlert,
  type RpcLog,
} from "./hood-buybot";

const TOKEN = "0x1111111111111111111111111111111111111111";
const TRADER = "0x16c630fafca17eed7f1368ef58d08fead0241b23";

function word(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}
// isBuy=1, ethAmount=0.25e18, tokenAmount=1_000_000e18
const BUY_LOG: RpcLog = {
  topics: [TRADE_TOPIC0, addressTopic(TOKEN), addressTopic(TRADER)],
  data: "0x" + word(BigInt(1)) + word(BigInt("250000000000000000")) + word(BigInt("1000000000000000000000000")),
  transactionHash: "0xdeadbeef",
  blockNumber: "0x64",
};
const SELL_LOG: RpcLog = { ...BUY_LOG, data: "0x" + word(BigInt(0)) + word(BigInt("1")) + word(BigInt("1")) };

describe("topic helpers", () => {
  it("round-trips an address through a 32-byte topic", () => {
    expect(addressTopic(TOKEN)).toBe("0x" + "0".repeat(24) + TOKEN.slice(2));
    expect(addressFromTopic(addressTopic(TRADER))).toBe(TRADER);
  });
});

describe("decodeTradeLog", () => {
  it("decodes a buy", () => {
    const t = decodeTradeLog(BUY_LOG)!;
    expect(t.isBuy).toBe(true);
    expect(t.token).toBe(TOKEN);
    expect(t.trader).toBe(TRADER);
    expect(t.ethWei).toBe(BigInt("250000000000000000"));
    expect(t.tokenWei).toBe(BigInt("1000000000000000000000000"));
    expect(t.blockNumber).toBe(100);
  });
  it("flags a sell as isBuy=false (so the bot skips it)", () => {
    expect(decodeTradeLog(SELL_LOG)!.isBuy).toBe(false);
  });
  it("returns null on wrong topic / short data", () => {
    expect(decodeTradeLog({ ...BUY_LOG, topics: ["0xother", "", ""] })).toBeNull();
    expect(decodeTradeLog({ ...BUY_LOG, data: "0x00" })).toBeNull();
    expect(decodeTradeLog({ topics: [], data: "0x" })).toBeNull();
  });
});

describe("fmtUnits", () => {
  it("formats ETH + token amounts, trimming zeros", () => {
    expect(fmtUnits(BigInt("250000000000000000"), 18)).toBe("0.25");
    expect(fmtUnits(BigInt("1000000000000000000000000"), 18, 2)).toBe("1,000,000");
    expect(fmtUnits(BigInt(0), 18)).toBe("0");
  });
});

describe("formatBuyAlert", () => {
  it("renders a buy alert with $ value and a Blockscout link", () => {
    const msg = formatBuyAlert({
      tokenSymbol: "$LOOP",
      ethWei: BigInt("250000000000000000"),
      tokenWei: BigInt("1000000000000000000000000"),
      trader: TRADER,
      txHash: "0xabc",
      ethUsd: 3000,
      priceUsd: 0.0000012,
    });
    expect(msg).toContain("🟢 $LOOP Buy!");
    expect(msg).toContain("0.25 ETH");
    expect(msg).toContain("($750)");
    expect(msg).toContain("1,000,000 LOOP");
    expect(msg).toContain("robinhoodchain.blockscout.com/tx/0xabc");
    expect(msg).not.toContain("<script"); // values only — injection-safe
  });
  it("omits the price/tx lines when absent", () => {
    const msg = formatBuyAlert({ tokenSymbol: "LOOP", ethWei: BigInt(0), tokenWei: BigInt(0), trader: TRADER, txHash: null });
    expect(msg).not.toContain("📈");
    expect(msg).not.toContain("🔗");
  });
});
