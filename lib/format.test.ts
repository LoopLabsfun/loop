import { describe, it, expect } from "vitest";
import {
  usd,
  sol,
  cashtag,
  fmtPrice,
  fmtPriceSub,
  compactUsd,
  compactNum,
  countdown,
  shortAge,
  nowStamp,
  explorerTx,
  repoSlug,
  repoUrl,
  commitUrl,
} from "./format";

describe("cashtag", () => {
  it("adds exactly one leading $ whether or not the ticker already has one", () => {
    expect(cashtag("FAME")).toBe("$FAME"); // prelaunch-draft shape
    expect(cashtag("$FAME")).toBe("$FAME"); // launched-project shape (was double-$)
    expect(cashtag("$$FAME")).toBe("$FAME"); // collapses an already-doubled value
  });
  it("trims and handles empty/null", () => {
    expect(cashtag("  LOOP ")).toBe("$LOOP");
    expect(cashtag("")).toBe("");
    expect(cashtag(null)).toBe("");
    expect(cashtag(undefined)).toBe("");
    expect(cashtag("$")).toBe("");
  });
});

describe("usd", () => {
  it("formats with thousands separators and 2 decimals", () => {
    expect(usd(2043.6)).toBe("2,043.60");
    expect(usd(0)).toBe("0.00");
  });
  it("renders non-finite input as 0.00 (never NaN/∞)", () => {
    expect(usd(NaN)).toBe("0.00");
    expect(usd(Infinity)).toBe("0.00");
    expect(usd(-Infinity)).toBe("0.00");
  });
});

describe("sol", () => {
  it("fixes to 2 decimals by default", () => {
    expect(sol(12.4631)).toBe("12.46");
    expect(sol(1.2, 3)).toBe("1.200");
  });
  it("renders non-finite input as zero at the requested precision", () => {
    expect(sol(NaN)).toBe("0.00");
    expect(sol(Infinity, 3)).toBe("0.000");
  });
});

describe("fmtPrice", () => {
  it("uses 4 decimals at or above 0.01", () => {
    expect(fmtPrice(0.0421)).toBe("$0.0421");
  });
  it("uses 6 decimals below 0.01", () => {
    expect(fmtPrice(0.00029)).toBe("$0.000290");
  });
  it("keeps significant figures for tiny prices (no misleading round-off)", () => {
    // The bug: 0.0000062 collapsed to "$0.000006" (1 sig fig). Now it shows the
    // real value with ~3 significant figures past the leading zeros.
    expect(fmtPrice(0.0000062)).toBe("$0.00000620");
    expect(fmtPrice(0.0000062)).not.toBe("$0.000006");
    expect(fmtPrice(0.00001234)).toBe("$0.0000123");
    // Existing precision in the 0.001–0.01 range is unchanged.
    expect(fmtPrice(0.001234)).toBe("$0.001234");
  });
  it("returns $0.0000 for non-finite inputs (NaN, Infinity)", () => {
    expect(fmtPrice(NaN)).toBe("$0.0000");
    expect(fmtPrice(Infinity)).toBe("$0.0000");
    expect(fmtPrice(-Infinity)).toBe("$0.0000");
  });
});

describe("fmtPriceSub", () => {
  it("collapses a long zero run to a subscript count", () => {
    expect(fmtPriceSub(0.00000190)).toBe("$0.0₅190");
    expect(fmtPriceSub(0.0000062)).toBe("$0.0₅620");
  });
  it("keeps the plain form when the zero run is short", () => {
    expect(fmtPriceSub(0.001234)).toBe("$0.001234");
    expect(fmtPriceSub(0.0421)).toBe("$0.0421");
  });
  it("carries rounding out of the zero run instead of growing the mantissa", () => {
    // 0.0000009999 rounds up past the run: 0.00000100 — one zero fewer, not a
    // 4-digit mantissa ("$0.0₆1000").
    expect(fmtPriceSub(0.0000009999)).toBe("$0.0₅100");
    // No carry: 3 sig digits fit as-is.
    expect(fmtPriceSub(0.000000999)).toBe("$0.0₆999");
  });
  it("handles a two-digit zero run", () => {
    expect(fmtPriceSub(1.23e-11)).toBe("$0.0₁₀123");
  });
  it("returns $0.00 for non-finite or non-positive input", () => {
    expect(fmtPriceSub(NaN)).toBe("$0.00");
    expect(fmtPriceSub(0)).toBe("$0.00");
  });
});

describe("compactUsd", () => {
  it("formats typical values", () => {
    expect(compactUsd(0)).toBe("—");
    expect(compactUsd(500)).toBe("$500");
    expect(compactUsd(1234)).toBe("$1.2K");
    expect(compactUsd(6_900_000)).toBe("$6.9M");
  });
  it("promotes K→M at the 999_999 boundary (rounding carry)", () => {
    expect(compactUsd(999_999)).toBe("$1.0M");
  });
  it("promotes M→B at the 999_999_999 boundary (rounding carry)", () => {
    expect(compactUsd(999_999_999)).toBe("$1.0B");
  });
});

describe("compactNum", () => {
  it("formats typical values", () => {
    expect(compactNum(0)).toBe("0");
    expect(compactNum(42)).toBe("42");
    expect(compactNum(1234)).toBe("1.2K");
    expect(compactNum(1_000_000)).toBe("1.0M");
  });
  it("promotes K→M at the 999_999 boundary (rounding carry)", () => {
    expect(compactNum(999_999)).toBe("1.0M");
  });
  it("promotes M→B at the 999_999_999 boundary (rounding carry)", () => {
    expect(compactNum(999_999_999)).toBe("1.0B");
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
  it("returns 00:00 for non-finite inputs (NaN, Infinity)", () => {
    expect(countdown(NaN)).toBe("00:00");
    expect(countdown(Infinity)).toBe("00:00");
    expect(countdown(-Infinity)).toBe("00:00");
  });
});

describe("shortAge", () => {
  it("renders seconds, minutes, hours, then days", () => {
    expect(shortAge(45)).toBe("45s");
    expect(shortAge(120)).toBe("2m");
    expect(shortAge(3 * 3600 + 5)).toBe("3h");
    expect(shortAge(24 * 3600)).toBe("1d");
    expect(shortAge(72 * 3600)).toBe("3d");
  });
  it("floors fractional seconds", () => {
    expect(shortAge(45.9)).toBe("45s");
  });
  it("clamps non-finite and negative input to 0s", () => {
    expect(shortAge(-1)).toBe("0s");
    expect(shortAge(NaN)).toBe("0s");
    expect(shortAge(Infinity)).toBe("0s");
    expect(shortAge(-Infinity)).toBe("0s");
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
