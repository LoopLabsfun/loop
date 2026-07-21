import { describe, expect, it } from "vitest";
import { consensusForBucket, currentBucket, type TreasuryCheckRow } from "./treasury-checks";

function row(id: number, deviceId: string, lamports: number): TreasuryCheckRow {
  return { id, deviceId, lamports, consensusOk: null };
}

describe("consensusForBucket", () => {
  it("unanimous: all agree", () => {
    const v = consensusForBucket([row(1, "a", 1000), row(2, "b", 1000)]);
    expect(v.every((x) => x.consensusOk)).toBe(true);
  });

  it("flags the dissenting read", () => {
    const v = consensusForBucket([row(1, "a", 1000), row(2, "b", 1000), row(3, "evil", 999)]);
    expect(v.find((x) => x.id === 1)!.consensusOk).toBe(true);
    expect(v.find((x) => x.id === 2)!.consensusOk).toBe(true);
    expect(v.find((x) => x.id === 3)!.consensusOk).toBe(false);
  });

  it("a lone report is unverified, not flagged — needs redundancy first", () => {
    expect(consensusForBucket([row(1, "a", 1000)])).toHaveLength(0);
  });

  it("empty input is safe", () => {
    expect(consensusForBucket([])).toEqual([]);
  });

  it("a genuine tie breaks deterministically (same input → same verdict every time)", () => {
    const rows = [row(1, "a", 100), row(2, "b", 200)];
    const v1 = consensusForBucket(rows);
    const v2 = consensusForBucket(rows);
    expect(v1).toEqual(v2);
  });
});

describe("currentBucket", () => {
  it("floors to a 5-minute window", () => {
    const t = Date.parse("2026-07-21T10:07:33Z");
    expect(currentBucket(t)).toBe("2026-07-21T10:05:00.000Z");
  });

  it("two timestamps in the same window produce the same bucket", () => {
    const a = currentBucket(Date.parse("2026-07-21T10:05:00Z"));
    const b = currentBucket(Date.parse("2026-07-21T10:09:59Z"));
    expect(a).toBe(b);
  });

  it("crossing a window boundary changes the bucket", () => {
    const a = currentBucket(Date.parse("2026-07-21T10:09:59Z"));
    const b = currentBucket(Date.parse("2026-07-21T10:10:00Z"));
    expect(a).not.toBe(b);
  });
});
