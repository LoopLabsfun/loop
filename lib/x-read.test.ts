import { describe, it, expect } from "vitest";
import { parseMentions } from "./x-read";

describe("parseMentions", () => {
  it("maps tweets to authors via includes.users", () => {
    const out = parseMentions({
      data: [
        { id: "10", text: "@Looplabsfun this is great", author_id: "u1" },
        { id: "11", text: "interesting structure", author_id: "u2" },
      ],
      includes: { users: [{ id: "u1", username: "alice" }, { id: "u2", username: "bob" }] },
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ tweetId: "10", author: "alice" });
    expect(out[1]).toMatchObject({ tweetId: "11", author: "bob" });
  });

  it("falls back to 'someone' when the author isn't in includes", () => {
    const out = parseMentions({ data: [{ id: "1", text: "hi", author_id: "x" }] });
    expect(out[0].author).toBe("someone");
  });

  it("skips entries missing id or text, and tolerates junk", () => {
    expect(parseMentions(null)).toEqual([]);
    expect(parseMentions({})).toEqual([]);
    expect(parseMentions({ data: [{ id: "1" }, { text: "no id" }] })).toEqual([]);
  });
});
