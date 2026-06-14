import { describe, it, expect } from "vitest";
import { parseVanityPool } from "./vanity";

describe("parseVanityPool", () => {
  const key = (fill: number) => Array.from({ length: 64 }, () => fill);

  it("returns [] for unset / invalid / non-array", () => {
    expect(parseVanityPool(undefined)).toEqual([]);
    expect(parseVanityPool("")).toEqual([]);
    expect(parseVanityPool("not json")).toEqual([]);
    expect(parseVanityPool('{"a":1}')).toEqual([]);
    expect(parseVanityPool("[1,2,3]")).toEqual([]);
  });

  it("keeps only well-formed 64-byte secret-key arrays", () => {
    const good = key(7);
    const tooShort = Array.from({ length: 32 }, () => 1);
    const notNums = Array.from({ length: 64 }, () => "x");
    const pool = parseVanityPool(JSON.stringify([good, tooShort, notNums, good]));
    expect(pool).toHaveLength(2);
    expect(pool[0]).toHaveLength(64);
  });
});
