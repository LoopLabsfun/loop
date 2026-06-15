import { describe, it, expect } from "vitest";
import {
  sanitizeDirectiveText,
  rowToFeedItem,
  DIRECTIVE_TEXT_MAX,
  type DirectiveRow,
} from "./directives";

const row = (over: Partial<DirectiveRow> = {}): DirectiveRow => ({
  id: "7",
  project_key: "demo",
  kind: "directive",
  text: "Ship the mobile build next.",
  author_wallet: null,
  role: "holder",
  status: "open",
  for_votes: 0,
  against_votes: 0,
  quorum: 100,
  created_at: new Date().toISOString(),
  ...over,
});

describe("sanitizeDirectiveText", () => {
  it("trims and collapses internal whitespace", () => {
    expect(sanitizeDirectiveText("  ship   the\n\n build  ")).toBe("ship the build");
  });
  it("caps at the column limit", () => {
    const long = "a".repeat(DIRECTIVE_TEXT_MAX + 50);
    expect(sanitizeDirectiveText(long).length).toBe(DIRECTIVE_TEXT_MAX);
  });
  it("returns empty for whitespace-only input", () => {
    expect(sanitizeDirectiveText("   \n\t ")).toBe("");
  });
});

describe("rowToFeedItem", () => {
  it("maps a directive row to a prefixed feed item", () => {
    const item = rowToFeedItem(row(), "2m ago");
    expect(item).toMatchObject({
      id: "d7",
      kind: "directive",
      at: "2m ago",
      text: "Ship the mobile build next.",
      status: "open",
      by: "holder",
    });
    expect(item.forVotes).toBeUndefined(); // directives carry no tally
  });

  it("includes the vote tally for proposals", () => {
    const item = rowToFeedItem(
      row({ kind: "proposal", for_votes: 62, against_votes: 18, quorum: 100 }),
      "now"
    );
    expect(item.kind).toBe("proposal");
    expect(item).toMatchObject({ forVotes: 62, againstVotes: 18, quorum: 100 });
  });

  it("shortens an author wallet for the by-label", () => {
    const item = rowToFeedItem(row({ author_wallet: "9xQabc12345678wxyz" }), "now");
    expect(item.by).toBe("9xQa…wxyz");
  });

  it("labels a founder row when no wallet is recorded", () => {
    expect(rowToFeedItem(row({ role: "founder" }), "now").by).toBe("founder");
  });

  it("falls back to open for an unknown status", () => {
    expect(rowToFeedItem(row({ status: "weird" }), "now").status).toBe("open");
  });
});
