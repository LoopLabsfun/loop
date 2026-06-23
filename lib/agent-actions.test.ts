import { describe, it, expect } from "vitest";
import {
  evaluateAction,
  isIrreversible,
  walletFor,
  DEFAULT_POLICY,
  type AgentAction,
} from "./agent-actions";

describe("isIrreversible", () => {
  it("flags burn and airdrop, not buyback/swap/bounty", () => {
    expect(isIrreversible("burn")).toBe(true);
    expect(isIrreversible("airdrop")).toBe(true);
    expect(isIrreversible("buyback")).toBe(false);
    expect(isIrreversible("swap")).toBe(false);
    expect(isIrreversible("bounty")).toBe(false);
  });
});

describe("evaluateAction", () => {
  const buyback = (amountSol: number): AgentAction => ({ kind: "buyback", amountSol });

  it("allows a reversible action within budget", () => {
    const v = evaluateAction(buyback(0.2));
    expect(v.ok).toBe(true);
    expect(v.escalate).toBe(false);
  });

  it("escalates (not allows) an irreversible action even within budget", () => {
    const v = evaluateAction({ kind: "burn", amountSol: 0.1 });
    expect(v.ok).toBe(false);
    expect(v.escalate).toBe(true);
    expect(v.reason).toMatch(/irreversible/i);
  });

  it("blocks irreversible outright when policy disallows it", () => {
    const v = evaluateAction(
      { kind: "airdrop", amountTokens: 1000 },
      { ...DEFAULT_POLICY, allowIrreversible: false }
    );
    expect(v).toMatchObject({ ok: false, escalate: false });
  });

  it("escalates when over the per-action cap", () => {
    const v = evaluateAction(buyback(0.9)); // cap 0.5
    expect(v).toMatchObject({ ok: false, escalate: true });
    expect(v.reason).toMatch(/per-action cap/);
  });

  it("escalates when the action would breach the 24h cap", () => {
    const v = evaluateAction(buyback(0.4), DEFAULT_POLICY, 1.8); // 1.8+0.4 > 2
    expect(v).toMatchObject({ ok: false, escalate: true });
    expect(v.reason).toMatch(/24h cap/);
  });

  it("rejects a negative amount without escalating", () => {
    expect(evaluateAction(buyback(-1))).toMatchObject({ ok: false, escalate: false });
  });

  it("rejects a zero-SOL buyback as a no-op (never reaches the exec layer)", () => {
    const v = evaluateAction(buyback(0));
    expect(v).toMatchObject({ ok: false, escalate: false });
    expect(v.reason).toMatch(/zero amount/i);
  });
});

describe("walletFor", () => {
  it("routes swaps to cold treasury and everything else to hot", () => {
    expect(walletFor("swap")).toBe("cold_treasury");
    expect(walletFor("buyback")).toBe("hot");
    expect(walletFor("burn")).toBe("hot");
  });
});
