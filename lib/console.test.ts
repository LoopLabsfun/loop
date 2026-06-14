import { describe, it, expect } from "vitest";
import { defaultMandate, roleFor, seedFeed } from "./console";
import type { Project } from "./types";

const base: Project = {
  key: "demo" as Project["key"],
  name: "Demo",
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

describe("roleFor", () => {
  it("is spectator when disconnected", () => {
    expect(roleFor(false, null, null)).toBe("spectator");
  });
  it("is founder when the connected wallet is the creator", () => {
    expect(roleFor(true, "WALLET1", "WALLET1")).toBe("founder");
  });
  it("is holder when connected but not the creator", () => {
    expect(roleFor(true, "WALLET2", "WALLET1")).toBe("holder");
    expect(roleFor(true, "WALLET2", null)).toBe("holder");
  });
});

describe("defaultMandate", () => {
  it("uses Opus for official projects, Sonnet otherwise", () => {
    expect(defaultMandate({ ...base, official: true }).model).toBe("Opus");
    expect(defaultMandate(base).model).toBe("Sonnet");
  });
  it("falls back to a generated mission when description is empty", () => {
    expect(defaultMandate({ ...base, description: "" }).mission).toContain(
      "Demo"
    );
  });
});

describe("seedFeed", () => {
  it("includes an open escalation and an open proposal", () => {
    const feed = seedFeed(base);
    expect(feed.some((f) => f.kind === "escalation" && f.status === "open")).toBe(
      true
    );
    expect(feed.some((f) => f.kind === "proposal" && f.status === "open")).toBe(
      true
    );
  });
});
