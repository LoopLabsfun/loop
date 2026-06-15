import { describe, it, expect } from "vitest";
import { parseVanityPool, parseSecretKeyJson } from "./vanity";

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

describe("parseSecretKeyJson", () => {
  const key = (fill: number) => Array.from({ length: 64 }, () => fill);

  it("accepts a 64-number array (claimed jsonb)", () => {
    expect(parseSecretKeyJson(key(3))).toHaveLength(64);
  });
  it("accepts a JSON-string 64-number array", () => {
    expect(parseSecretKeyJson(JSON.stringify(key(5)))).toHaveLength(64);
  });
  it("rejects wrong length / type / junk", () => {
    expect(parseSecretKeyJson(key(1).slice(0, 32))).toBeNull();
    expect(parseSecretKeyJson(Array.from({ length: 64 }, () => "x"))).toBeNull();
    expect(parseSecretKeyJson(null)).toBeNull();
    expect(parseSecretKeyJson("not json")).toBeNull();
  });
});
