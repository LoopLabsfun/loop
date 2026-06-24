import { describe, it, expect } from "vitest";
import {
  usd,
  sol,
  fmtPrice,
  countdown,
  shortAge,
  nowStamp,
  explorerTx,
  repoSlug,
  repoUrl,
  commitUrl,
} from "./format";

describe("usd", () => {
  it("formats with thousands separators and 2 decimals", () => {
    expect(usd(2043.6)).toBe("2,043.60");
    expect(usd(0)).toBe("0.00");
  });
});

describe("sol", () => {
  it("fixes to 2 decimals by default", () => {
    expect(sol(12.4631)).toBe("12.46");
    expect(sol(1.2, 3)).toBe("1.200");
  });
});

describe("fmtPrice", () => {
  it("uses 4 decimals at or above 0.01", () => {
    expect(fmtPrice(0.0421)).toBe("$0.0421");
  });
  it("uses 6 decimals below 0.01", () => {
    expect(fmtPrice(0.00029)).toBe("$0.000290");
  });
});

describe("countdown", () => {
  it("formats mm:ss with a leading zero on minutes", () => {
    expect(countdown(165)).toBe("02:45");
    expect(countdown(5)).toBe("00:05");
    expect(countdown(0)).toBe("00:00");
  });
  it("does not over-pad double-digit minutes", () => {
    expect(countdown(600)).toBe("10:00");
    expect(countdown(3599)).toBe("59:59");
  });
  it("clamps negative inputs to 00:00", () => {
    expect(countdown(-1)).toBe("00:00");
    expect(countdown(-60)).toBe("00:00");
  });
  it("floors fractional seconds", () => {
    expect(countdown(5.9)).toBe("00:05");
    expect(countdown(65.99)).toBe("01:05");
  });
});

describe("shortAge", () => {
  it("renders seconds, minutes, then hours", () => {
    expect(shortAge(45)).toBe("45s");
    expect(shortAge(120)).toBe("2m");
    expect(shortAge(3 * 3600 + 5)).toBe("3h");
  });
});

describe("nowStamp", () => {
  it("zero-pads a [HH:MM:SS] timestamp", () => {
    expect(nowStamp(new Date(2026, 0, 1, 9, 4, 7))).toBe("[09:04:07]");
  });
});

describe("explorerTx", () => {
  it("links to a tx on mainnet without a cluster param", () => {
    expect(explorerTx("5sig")).toBe("https://explorer.solana.com/tx/5sig");
  });
  it("appends ?cluster=devnet on devnet", () => {
    expect(explorerTx("5sig", "devnet")).toBe(
      "https://explorer.solana.com/tx/5sig?cluster=devnet"
    );
  });
});

describe("repoSlug / repoUrl / commitUrl (verifiable build feed)", () => {
  it("normalizes the repo string forms to owner/name", () => {
    expect(repoSlug("github.com/LoopLabsfun/loop")).toBe("LoopLabsfun/loop");
    expect(repoSlug("https://github.com/LoopLabsfun/loop.git")).toBe("LoopLabsfun/loop");
    expect(repoSlug("LoopLabsfun/loop")).toBe("LoopLabsfun/loop");
    expect(repoSlug("LoopLabsfun/loop/")).toBe("LoopLabsfun/loop");
  });
  it("returns null for non owner/name strings", () => {
    expect(repoSlug("")).toBeNull();
    expect(repoSlug("not-a-repo")).toBeNull();
    expect(repoSlug("github.com/onlyowner")).toBeNull();
  });
  it("builds repo + commit URLs anyone can open to verify a ship", () => {
    expect(repoUrl("github.com/LoopLabsfun/loop")).toBe("https://github.com/LoopLabsfun/loop");
    expect(commitUrl("github.com/LoopLabsfun/loop", "6c0ca9b")).toBe(
      "https://github.com/LoopLabsfun/loop/commit/6c0ca9b"
    );
  });
  it("returns null when repo or hash can't resolve (UI falls back to plain text)", () => {
    expect(repoUrl("nope")).toBeNull();
    expect(commitUrl("nope", "6c0ca9b")).toBeNull();
    expect(commitUrl("github.com/LoopLabsfun/loop", "")).toBeNull();
  });
});
