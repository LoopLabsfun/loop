import { describe, it, expect, afterEach } from "vitest";
import {
  chatBasePrice,
  chatCost,
  toBaseUnits,
  rowToChatMsg,
  creditedBaseUnits,
  buildChatContext,
  type ChatRow,
} from "./chat";

const row = (over: Partial<ChatRow> = {}): ChatRow => ({
  id: 7,
  wallet: "9xQabc12345678wxyz",
  question: "What are you building next?",
  answer: null,
  loop_paid: 1500,
  boost: 500,
  tx_sig: "sig123",
  status: "open",
  created_at: new Date().toISOString(),
  ...over,
});

describe("chatBasePrice", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_CHAT_LOOP_PRICE;
  });
  it("defaults to 1000 when unset or invalid", () => {
    expect(chatBasePrice()).toBe(1000);
    process.env.NEXT_PUBLIC_CHAT_LOOP_PRICE = "not-a-number";
    expect(chatBasePrice()).toBe(1000);
  });
  it("honours a positive override", () => {
    process.env.NEXT_PUBLIC_CHAT_LOOP_PRICE = "2500";
    expect(chatBasePrice()).toBe(2500);
  });
});

describe("chatCost", () => {
  it("adds a positive boost to the base", () => {
    expect(chatCost(500, 1000)).toBe(1500);
  });
  it("ignores a negative / NaN boost", () => {
    expect(chatCost(-9, 1000)).toBe(1000);
    expect(chatCost(NaN, 1000)).toBe(1000);
  });
});

describe("toBaseUnits", () => {
  it("scales whole and fractional amounts to base units", () => {
    expect(toBaseUnits(1000, 6)).toBe(BigInt(1000000000));
    expect(toBaseUnits(1.5, 6)).toBe(BigInt(1500000));
    expect(toBaseUnits(0.000001, 6)).toBe(BigInt(1));
  });
  it("returns 0 base units for non-positive / non-finite input", () => {
    expect(toBaseUnits(0, 6)).toBe(BigInt(0));
    expect(toBaseUnits(-5, 6)).toBe(BigInt(0));
    expect(toBaseUnits(NaN, 6)).toBe(BigInt(0));
  });
  it("rounds to the token's decimals (sub-unit dust collapses cleanly)", () => {
    expect(toBaseUnits(1.2345678, 6)).toBe(BigInt(1234568)); // toFixed(6) rounds
  });
});

describe("rowToChatMsg", () => {
  it("maps a queued row", () => {
    const m = rowToChatMsg(row(), "2m ago");
    expect(m).toMatchObject({
      id: "q7",
      wallet: "9xQabc12345678wxyz",
      question: "What are you building next?",
      answer: null,
      loopPaid: 1500,
      boost: 500,
      txSig: "sig123",
      status: "open",
      at: "2m ago",
    });
  });
  it("maps an answered row", () => {
    const m = rowToChatMsg(row({ status: "answered", answer: "Shipping the drawer." }), "now");
    expect(m.status).toBe("answered");
    expect(m.answer).toBe("Shipping the drawer.");
  });
  it("normalises an unknown status to open and null tallies to 0", () => {
    const m = rowToChatMsg(row({ status: "weird", loop_paid: null, boost: null }), "now");
    expect(m.status).toBe("open");
    expect(m.loopPaid).toBe(0);
    expect(m.boost).toBe(0);
  });
});

describe("creditedBaseUnits (on-chain payment verification)", () => {
  const MINT = "LoopMint11111111111111111111111111111111111";
  const TREASURY = "Treasury1111111111111111111111111111111111";
  const bal = (owner: string, mint: string, amount: string) => ({
    owner,
    mint,
    uiTokenAmount: { amount },
  });

  it("credits a fresh treasury ATA (absent from pre) the full received amount", () => {
    const post = [bal(TREASURY, MINT, "1000000000")]; // 1000 $LOOP @ 6dp
    expect(creditedBaseUnits([], post, MINT, TREASURY)).toBe(BigInt(1000000000));
    expect(creditedBaseUnits(undefined, post, MINT, TREASURY)).toBe(BigInt(1000000000));
  });

  it("credits the DELTA when the treasury already held the token", () => {
    const pre = [bal(TREASURY, MINT, "500000000")];
    const post = [bal(TREASURY, MINT, "1500000000")];
    expect(creditedBaseUnits(pre, post, MINT, TREASURY)).toBe(BigInt(1000000000));
  });

  it("ignores other owners and other mints", () => {
    const post = [
      bal("SomeoneElse", MINT, "9999999999"),
      bal(TREASURY, "OtherMint", "9999999999"),
    ];
    expect(creditedBaseUnits([], post, MINT, TREASURY)).toBe(BigInt(0));
  });

  it("is non-positive when nothing moved to the treasury", () => {
    const same = [bal(TREASURY, MINT, "500000000")];
    expect(creditedBaseUnits(same, same, MINT, TREASURY)).toBe(BigInt(0));
  });
});

describe("buildChatContext (recent-ships block)", () => {
  it("is empty for no commits", () => {
    expect(buildChatContext([])).toBe("");
    expect(buildChatContext(undefined)).toBe("");
    expect(buildChatContext(null)).toBe("");
  });
  it("bullets the first line of each message", () => {
    const out = buildChatContext([
      { msg: "feat: paid chat\n\nlong body ignored" },
      { msg: "fix: mascot" },
    ]);
    expect(out).toBe("- feat: paid chat\n- fix: mascot");
  });
  it("caps the list and skips blank messages", () => {
    const commits = [
      { msg: "a" },
      { msg: "  " },
      { msg: "b" },
      { msg: "c" },
      { msg: "d" },
      { msg: "e" },
    ];
    const lines = buildChatContext(commits, 3).split("\n");
    expect(lines).toEqual(["- a", "- b", "- c"]);
  });
});
