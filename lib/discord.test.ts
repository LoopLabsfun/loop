import { describe, it, expect } from "vitest";
import {
  composeAgentDiscord,
  buildDiscordProgress,
  buildDiscordUpdate,
  buildDiscordLaunch,
  discordUsername,
  discordSignature,
} from "./discord";
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

describe("discordUsername", () => {
  it("derives a per-project webhook display name", () => {
    expect(discordUsername(base)).toBe("Demo Co agent");
  });
});

describe("composeAgentDiscord", () => {
  it("posts the agent's own words as content + a watch link, never pinging", () => {
    const p = composeAgentDiscord(base, "Shipped the dedup pass.");
    expect(p.content).toContain("Shipped the dedup pass.");
    expect(p.content).toContain("Watch it build →");
    expect(p.allowed_mentions).toEqual({ parse: [] });
    expect(p.username).toBe("Demo Co agent");
  });

  it("clamps content to Discord's 2000-char limit", () => {
    const p = composeAgentDiscord(base, "x".repeat(5000));
    expect((p.content ?? "").length).toBeLessThanOrEqual(2000);
  });
});

describe("buildDiscordProgress", () => {
  it("builds a 'building' embed (not 'shipped') with the work title", () => {
    const p = buildDiscordProgress(base, { title: "Wiring Discord", detail: "webhook path" });
    const e = p.embeds![0];
    expect(e.title).toContain("building");
    expect(e.description).toContain("Wiring Discord");
    expect(e.description).toContain("webhook path");
    expect(p.allowed_mentions).toEqual({ parse: [] });
  });
});

describe("buildDiscordUpdate", () => {
  it("renders shipped tasks, commits and treasury as embed fields", () => {
    const p = buildDiscordUpdate(base, {
      shipped: [{ id: "1", title: "ship it", detail: "", category: "feature", status: "shipped", at: "now" }],
      commits: [{ message: "feat: discord", when: "now" }],
      treasurySol: 12.46,
      treasuryDeltaSol: 1.2,
    });
    const e = p.embeds![0];
    expect(e.title).toContain("Demo Co build update");
    const names = (e.fields ?? []).map((f) => f.name).join(" ");
    expect(names).toContain("Shipped");
    expect(names).toContain("commit");
    expect(names).toContain("Treasury");
    const treasury = (e.fields ?? []).find((f) => f.name.includes("Treasury"));
    expect(treasury?.value).toBe("12.46 SOL (+1.20)");
  });

  it("omits empty sections but still yields a valid embed", () => {
    const p = buildDiscordUpdate(base, {});
    expect(p.embeds![0].fields).toEqual([]);
    expect(p.embeds![0].title).toContain("build update");
  });
});

describe("buildDiscordLaunch", () => {
  it("includes the CA in a code span and the trade link", () => {
    const p = buildDiscordLaunch({
      name: "Demo Co",
      symbol: "DEMO",
      mint: "MintAddr1111",
      url: "https://pump.fun/coin/MintAddr1111",
      description: "the thing",
    });
    const e = p.embeds![0];
    expect(e.title).toContain("$DEMO is live");
    expect(e.description).toContain("CA: `MintAddr1111`");
    expect(e.description).toContain("Trade →");
  });
});

describe("discordSignature", () => {
  it("returns content when present, else the embed description/fields", () => {
    expect(discordSignature(composeAgentDiscord(base, "hi"))).toContain("hi");
    const upd = buildDiscordUpdate(base, { treasurySol: 1 });
    expect(discordSignature(upd)).toContain("Treasury");
  });
});
