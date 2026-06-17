import { describe, it, expect } from "vitest";
import { buildLaunchTweet, TWEET_MAX } from "./x-recap";
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
