import { describe, it, expect } from "vitest";
import {
  buildLaunchTweet,
  buildSelfLaunchTweet,
  buildShipTweet,
  buildProgressTweet,
  composeAgentTweet,
  TWEET_MAX,
} from "./x-recap";
import type { Project } from "./types";

const base: Project = {
  key: "demo" as Project["key"],
  name: "Demo Co",
  ticker: "$DEMO",
  description: "A demo project that builds itself.",
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

describe("buildLaunchTweet", () => {
  it("includes the name, ticker, handle, vision and link", () => {
    const t = buildLaunchTweet(base);
    expect(t).toContain("Demo Co ($DEMO)");
    expect(t).toContain("@loop");
    expect(t).toContain("builds itself");
    expect(t).toContain("www.looplabs.fun/token?p=demo");
    expect(t).toContain("funded by its market");
  });

  it("honors a custom handle and url", () => {
    const t = buildLaunchTweet(base, { loopHandle: "@loop_fun", url: "https://loop.fun/x" });
    expect(t).toContain("@loop_fun");
    expect(t).toContain("https://loop.fun/x");
  });

  it("never exceeds the 280-char limit, even with a long vision", () => {
    const t = buildLaunchTweet({ ...base, description: "x".repeat(600) });
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
    expect(t).toContain("…"); // the vision got trimmed
    expect(t).toContain("www.looplabs.fun/token?p=demo"); // the link is preserved
  });

  it("drops the vision line cleanly when there's no description", () => {
    const t = buildLaunchTweet({ ...base, description: "" });
    expect(t).toContain("Demo Co ($DEMO)");
    expect(t).toContain("funded by its market");
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
  });
});

describe("buildSelfLaunchTweet", () => {
  const mint = "AbCdEfGhiJkLmNoPqRsTuVwXyZ1234567890abcdLoop";
  const url = `https://pump.fun/coin/${mint}`;

  it("includes the symbol, CA and trade link", () => {
    const t = buildSelfLaunchTweet({
      name: "LOOP",
      symbol: "LOOP",
      mint,
      url,
      description: "The autonomous software factory.",
    });
    expect(t).toContain("$LOOP is live on pump.fun");
    expect(t).toContain(`CA: ${mint}`);
    expect(t).toContain(url);
    expect(t).toContain("autonomous software factory");
  });

  it("never exceeds 280 chars and always keeps the CA + link", () => {
    const t = buildSelfLaunchTweet({
      name: "LOOP",
      symbol: "LOOP",
      mint,
      url,
      description: "x".repeat(600),
    });
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
    expect(t).toContain(`CA: ${mint}`);
    expect(t).toContain(url);
  });

  it("drops the description cleanly when absent", () => {
    const t = buildSelfLaunchTweet({ name: "LOOP", symbol: "LOOP", mint, url });
    expect(t).toContain("$LOOP is live on pump.fun");
    expect(t).toContain(`CA: ${mint}`);
    expect(t).toContain(url);
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
  });
});

describe("buildShipTweet", () => {
  // Count X cashtags: "$" immediately followed by a letter.
  const cashtags = (s: string) => (s.match(/\$(?=[A-Za-z])/g) ?? []).length;

  it("includes the ticker, the shipped title, the closer and the link", () => {
    const t = buildShipTweet(base, {
      title: "Live market data on every card",
      detail: "Wired DexScreener into the landing cards.",
    });
    expect(t).toContain("$DEMO shipped:");
    expect(t).toContain("Live market data on every card");
    expect(t).toContain("Wired DexScreener");
    expect(t).toContain("funded by its market");
    expect(t).toContain("www.looplabs.fun/token?p=demo");
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
  });

  it("carries exactly ONE cashtag even when the task text adds more", () => {
    const t = buildShipTweet(base, {
      title: "Bought back $DEMO with treasury SOL",
      detail: "Swapped $SOL → $DEMO via Jupiter.",
    });
    expect(cashtags(t)).toBe(1);
    // the extra cashtags are neutralized, not the words themselves
    expect(t).toContain("DEMO with treasury");
    expect(t).toContain("SOL");
  });

  it("never exceeds 280, keeps one cashtag, and preserves the link", () => {
    const t = buildShipTweet(base, {
      title: "x".repeat(400),
      detail: "y".repeat(400),
    });
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
    expect(cashtags(t)).toBe(1);
    expect(t).toContain("www.looplabs.fun/token?p=demo");
    expect(t).toContain("…"); // something got trimmed
  });

  it("drops the detail line cleanly when absent", () => {
    const t = buildShipTweet(base, { title: "Shipped the runway badge" });
    expect(t).toContain("$DEMO shipped: Shipped the runway badge");
    expect(t).toContain("funded by its market");
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
  });

  it("honors a custom url", () => {
    const t = buildShipTweet(base, { title: "Did a thing" }, { url: "https://loop.fun/x" });
    expect(t).toContain("https://loop.fun/x");
  });
});

describe("buildProgressTweet", () => {
  const cashtags = (s: string) => (s.match(/\$(?=[A-Za-z])/g) ?? []).length;

  it("frames as 'building' (never claims shipped) and stays honest", () => {
    const t = buildProgressTweet(base, {
      title: "Wiring the CI smoke gate",
      detail: "Type-check + smoke test on every push.",
    });
    expect(t).toContain("$DEMO building:");
    expect(t).not.toContain("shipped");
    expect(t).toContain("Wiring the CI smoke gate");
    expect(t).toContain("www.looplabs.fun/token?p=demo");
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
  });

  it("keeps exactly one cashtag and fits 280 even with overflowing text", () => {
    const t = buildProgressTweet(base, {
      title: "Buying back $DEMO ".repeat(40),
      detail: "z".repeat(400),
    });
    expect(cashtags(t)).toBe(1);
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
  });
});

describe("composeAgentTweet", () => {
  const cashtags = (s: string) => (s.match(/\$(?=[A-Za-z])/g) ?? []).length;

  it("posts the agent's own one-liner with a single cashtag + link footer", () => {
    const t = composeAgentTweet(base, "Taught the CI gate to type-check every push — fewer broken builds, faster merges.");
    expect(t).toContain("Taught the CI gate to type-check every push");
    expect(cashtags(t)).toBe(1);
    expect(t).toContain("$DEMO");
    expect(t).toContain("www.looplabs.fun/token?p=demo");
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
  });

  it("neutralizes extra cashtags the agent wrote and stays at one", () => {
    const t = composeAgentTweet(base, "Shipped a $DEMO buyback after the $SOL dip — treasury working for holders.");
    expect(cashtags(t)).toBe(1);
    expect(t).toContain("$DEMO");
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
  });

  it("collapses whitespace and fits 280 even when the agent overflows", () => {
    const t = composeAgentTweet(base, "word ".repeat(120));
    expect(t).toContain("$DEMO");
    expect(t).toContain("www.looplabs.fun/token?p=demo");
    expect(t).not.toMatch(/  +/);
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
  });

  it("does not duplicate the link when the agent already wrote it", () => {
    const url = "www.looplabs.fun/token?p=demo";
    const t = composeAgentTweet(base, `New dashboard is live → ${url}`);
    expect(t.split(url).length - 1).toBe(1);
    expect(t.length).toBeLessThanOrEqual(TWEET_MAX);
  });
});
