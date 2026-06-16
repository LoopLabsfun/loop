import { describe, it, expect } from "vitest";
import {
  agentSlug,
  agentEmail,
  agentTwitter,
  agentSite,
  seedTasks,
  seedInbox,
  seedSocial,
  seedSummaries,
  businessStats,
} from "./agent";
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
    expect(agentSite(base)).toBe("demo.looplabs.fun");
  });
});

describe("seeds", () => {
  it("tasks cover multiple categories and statuses", () => {
    const tasks = seedTasks(base);
    expect(tasks.length).toBeGreaterThanOrEqual(4);
    expect(new Set(tasks.map((t) => t.category)).size).toBeGreaterThan(1);
    expect(tasks.some((t) => t.status === "shipped")).toBe(true);
    expect(tasks.some((t) => t.status === "blocked")).toBe(true);
  });
  it("inbox has both sent and received messages", () => {
    const inbox = seedInbox(base);
    expect(inbox.some((m) => m.direction === "out")).toBe(true);
    expect(inbox.some((m) => m.direction === "in")).toBe(true);
  });
  it("social posts reference the project handle/site", () => {
    const posts = seedSocial(base);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.some((s) => s.text.includes("demo.looplabs.fun"))).toBe(true);
  });
});

describe("businessStats", () => {
  it("counts sent/received consistently with the inbox", () => {
    const stats = businessStats(base);
    const inbox = seedInbox(base);
    expect(stats.sentCount).toBe(inbox.filter((m) => m.direction === "out").length);
    expect(stats.receivedCount).toBe(inbox.filter((m) => m.direction === "in").length);
  });
  it("is deterministic for a given project", () => {
    expect(businessStats(base)).toEqual(businessStats(base));
  });
  it("zeroes revenue for official projects (the platform funds itself)", () => {
    expect(businessStats({ ...base, official: true }).revenueUsd).toBe(0);
  });
});

describe("seedSummaries", () => {
  it("is honest — includes a day with no ships and a note", () => {
    const s = seedSummaries(base);
    expect(s.length).toBeGreaterThan(0);
    const noShipDay = s.find((d) => d.shipped.length === 0);
    expect(noShipDay).toBeDefined();
    expect(noShipDay!.note.length).toBeGreaterThan(0);
  });
});
