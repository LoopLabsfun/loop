import { describe, it, expect } from "vitest";
import { agentSlug, agentEmail, agentTwitter, agentSite } from "./agent";
import type { Project } from "./types";

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

describe("agent identity", () => {
  it("derives a clean slug from the key", () => {
    expect(agentSlug(base)).toBe("demo");
  });
  it("strips $ and non-alphanumerics, falling back to ticker", () => {
    expect(agentSlug({ key: "" as Project["key"], ticker: "$LOOP" })).toBe("loop");
    expect(agentSlug({ key: "a b!c" as Project["key"], ticker: "$X" })).toBe("abc");
  });
  it("never returns an empty slug", () => {
    expect(agentSlug({ key: "" as Project["key"], ticker: "$" })).toBe("agent");
  });
  it("builds email / twitter / site from the slug", () => {
    expect(agentEmail(base)).toBe("demo@agents.looplabs.fun");
    expect(agentTwitter(base)).toBe("@demo_agent");
    expect(agentSite(base)).toBe("www.looplabs.fun/token?p=demo");
  });
});
