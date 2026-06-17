import { describe, it, expect } from "vitest";
import {
  telegramBotHandle,
  telegramBotUrl,
  escapeMarkdownV2,
  buildUpdateMessage,
  buildLaunchMessage,
} from "./telegram";
import type { AgentTask } from "./agent";
import type { Project, Commit } from "./types";

const base: Project = {
  key: "demo" as Project["key"],
  name: "Demo Co",
  ticker: "$DEMO",
  description: "A demo project.",
  official: false,
  launchpad: "Pump.fun",
  repo: "github.com/x/demo",
  cover: "neon",
  price: 0.0001,
  marketCap: "$30K",
  liquidity: "$4K",
  holders: "1",
  volume24h: "0 SOL",
  curve: 0.02,
  supply: "1B",
  treasurySol: 0,
  earnedSol: 0,
  burnPerDay: "0.10 SOL/day",
  runway: "booting",
};

const task = (title: string): AgentTask => ({
  id: title,
  title,
  detail: "",
  category: "feature",
  status: "shipped",
  at: "now",
});

const commit = (message: string): Commit => ({ message });

describe("bot identity", () => {
  it("derives a read-only bot handle + url from the slug", () => {
    expect(telegramBotHandle(base)).toBe("@demo_loop_bot");
    expect(telegramBotUrl(base)).toBe("https://t.me/demo_loop_bot");
  });
  it("strips $ / non-alphanumerics via the shared slug", () => {
    expect(telegramBotHandle({ key: "" as Project["key"], ticker: "$GTA-VI" })).toBe(
      "@gtavi_loop_bot"
    );
  });
});

describe("escapeMarkdownV2", () => {
  it("backslash-escapes every reserved character", () => {
    expect(escapeMarkdownV2("a.b-c!(x)")).toBe("a\\.b\\-c\\!\\(x\\)");
  });
  it("leaves plain text untouched", () => {
    expect(escapeMarkdownV2("hello world 42")).toBe("hello world 42");
  });
});

describe("buildUpdateMessage", () => {
  it("renders a header + watch link for an empty update", () => {
    const msg = buildUpdateMessage(base, {});
    expect(msg).toContain("🤖 *Demo Co* build update");
    expect(msg).toContain("Watch it build → www\\.looplabs\\.fun");
    expect(msg).not.toContain("Shipped");
    expect(msg).not.toContain("Treasury");
  });

  it("lists shipped tasks and commits, capped at 5", () => {
    const msg = buildUpdateMessage(base, {
      shipped: [task("a"), task("b")],
      commits: Array.from({ length: 7 }, (_, i) => commit(`c${i}`)),
    });
    expect(msg).toContain("✅ *Shipped*");
    expect(msg).toContain("• a");
    expect(msg).toContain("📦 *7 commits*"); // count reflects the real total…
    expect((msg.match(/• c\d/g) ?? []).length).toBe(5); // …but only 5 are listed
  });

  it("uses the singular for a single commit", () => {
    const msg = buildUpdateMessage(base, { commits: [commit("only one")] });
    expect(msg).toContain("📦 *1 commit*");
  });

  it("shows treasury balance with a signed, escaped delta", () => {
    const up = buildUpdateMessage(base, { treasurySol: 12.46, treasuryDeltaSol: 0.4 });
    expect(up).toContain("💰 Treasury: *12\\.46 SOL* \\(\\+0\\.40\\)");
    const down = buildUpdateMessage(base, { treasurySol: 12.46, treasuryDeltaSol: -0.4 });
    expect(down).toContain("\\(\\-0\\.40\\)");
  });

  it("omits the delta when it is zero or missing", () => {
    expect(buildUpdateMessage(base, { treasurySol: 5 })).toContain("💰 Treasury: *5\\.00 SOL*");
    expect(buildUpdateMessage(base, { treasurySol: 5, treasuryDeltaSol: 0 })).not.toContain("(");
  });

  it("escapes MarkdownV2 specials in dynamic task/commit text", () => {
    const msg = buildUpdateMessage(base, {
      shipped: [task("Fix curve (off-by-one)")],
      commits: [commit("feat: add v1.0 page")],
    });
    expect(msg).toContain("• Fix curve \\(off\\-by\\-one\\)");
    expect(msg).toContain("• feat: add v1\\.0 page");
  });
});

describe("buildLaunchMessage", () => {
  it("announces with an escaped header, code-span CA, and trade link", () => {
    const msg = buildLaunchMessage({
      name: "LOOP",
      symbol: "LOOP",
      mint: "AbcLoop",
      url: "https://pump.fun/coin/AbcLoop",
      description: "The autonomous software factory.",
    });
    expect(msg).toContain("🚀 *$LOOP is live on pump\\.fun*");
    expect(msg).toContain("The autonomous software factory\\.");
    expect(msg).toContain("CA: `AbcLoop`"); // raw CA in a code span (copy-paste)
    expect(msg).toContain("Trade → https://pump\\.fun/coin/AbcLoop");
  });

  it("omits the description block when absent (header, CA, trade only)", () => {
    const msg = buildLaunchMessage({ name: "X", symbol: "X", mint: "M", url: "u" });
    expect(msg).toContain("🚀 *$X is live on pump\\.fun*");
    expect(msg).toContain("CA: `M`");
    expect(msg.split("\n").length).toBe(5); // header, "", CA, "", trade
  });
});
