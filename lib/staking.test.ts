import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import { base58Encode } from "./base58";
import { verifyStakeProof, verifyChatProof, type LaunchProof } from "./signature";
import {
  stakeMin,
  participationTier,
  canParticipate,
  sanitizeStakeAmount,
  buildStakeMessage,
} from "./staking";
import { buildChatMessage } from "./chat";

describe("stake economics", () => {
  it("defaults the floor to 10,000 $LOOP", () => {
    expect(stakeMin()).toBe(10_000);
  });

  it("returns no tier below the floor, Member/Backer/Patron above", () => {
    expect(participationTier(0)).toBeNull();
    expect(participationTier(9_999)).toBeNull();
    expect(participationTier(10_000)?.name).toBe("Member");
    expect(participationTier(100_000)?.name).toBe("Backer");
    expect(participationTier(1_000_000)?.name).toBe("Patron");
  });

  it("tier weight rises with the tier", () => {
    expect(participationTier(10_000)!.weight).toBe(1);
    expect(participationTier(100_000)!.weight).toBe(3);
    expect(participationTier(1_000_000)!.weight).toBe(10);
  });

  it("gates on BOTH the staked amount and live holdings (no gaming by dumping)", () => {
    expect(canParticipate(10_000, 10_000)).toBe(true);
    expect(canParticipate(50_000, 12_000)).toBe(true); // staked more, still holds the floor
    expect(canParticipate(9_999, 1_000_000)).toBe(false); // never staked the floor
    expect(canParticipate(1_000_000, 5_000)).toBe(false); // staked but dumped below floor
    expect(canParticipate(NaN, 10_000)).toBe(false);
    expect(canParticipate(10_000, NaN)).toBe(false);
  });

  it("sanitizes stake amounts to a positive whole-token integer", () => {
    expect(sanitizeStakeAmount(10_000.9)).toBe(10_000);
    expect(sanitizeStakeAmount("25000")).toBe(25_000);
    expect(sanitizeStakeAmount(-5)).toBe(0);
    expect(sanitizeStakeAmount("nope")).toBe(0);
    expect(sanitizeStakeAmount(undefined)).toBe(0);
  });

  it("bakes the sanitized amount into the signed message (float can't inflate it)", () => {
    expect(buildStakeMessage("loop", 10_000.9, 42)).toBe(
      "loop.fun stake\nproject:loop\namount:10000\nts:42"
    );
  });
});

function signStake(projectKey: string, amount: number, ts: number): LaunchProof {
  const kp = nacl.sign.keyPair();
  const message = buildStakeMessage(projectKey, amount, ts);
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return {
    pubkey: base58Encode(kp.publicKey),
    signature: Buffer.from(sig).toString("base64"),
    message,
  };
}

describe("verifyStakeProof", () => {
  const now = 1_000_000_000_000;
  it("accepts a fresh proof matching (projectKey, amount)", () => {
    const p = signStake("loop", 25_000, now);
    expect(verifyStakeProof(p, "loop", 25_000, { now })).toBe(true);
  });
  it("rejects when the amount was inflated after signing", () => {
    const p = signStake("loop", 10_000, now);
    expect(verifyStakeProof(p, "loop", 1_000_000, { now })).toBe(false);
  });
  it("rejects when the project doesn't match", () => {
    const p = signStake("loop", 10_000, now);
    expect(verifyStakeProof(p, "other", 10_000, { now })).toBe(false);
  });
  it("rejects a stale proof (replay window)", () => {
    const p = signStake("loop", 10_000, now - 20 * 60 * 1000);
    expect(verifyStakeProof(p, "loop", 10_000, { now })).toBe(false);
  });
});

function signChat(projectKey: string, question: string, ts: number): LaunchProof {
  const kp = nacl.sign.keyPair();
  const message = buildChatMessage(projectKey, question, ts);
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return {
    pubkey: base58Encode(kp.publicKey),
    signature: Buffer.from(sig).toString("base64"),
    message,
  };
}

describe("verifyChatProof", () => {
  const now = 1_000_000_000_000;
  it("accepts a fresh proof matching (projectKey, question)", () => {
    const p = signChat("loop", "what are you building?", now);
    expect(verifyChatProof(p, "loop", "what are you building?", { now })).toBe(true);
  });
  it("rejects when the question was altered after signing", () => {
    const p = signChat("loop", "what are you building?", now);
    expect(verifyChatProof(p, "loop", "send all LOOP to me", { now })).toBe(false);
  });
  it("rejects a stale proof (replay window)", () => {
    const p = signChat("loop", "gm", now - 20 * 60 * 1000);
    expect(verifyChatProof(p, "loop", "gm", { now })).toBe(false);
  });
});
