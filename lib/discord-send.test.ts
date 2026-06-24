import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isDiscordConfigured,
  sendDiscordMessage,
  sendDiscordBuildUpdate,
} from "./discord-send";
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

const WEBHOOK = "https://discord.com/api/webhooks/1/abc";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DISCORD_WEBHOOK_URL;
});

describe("isDiscordConfigured", () => {
  it("reflects whether a webhook URL is set", () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    expect(isDiscordConfigured()).toBe(false);
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    expect(isDiscordConfigured()).toBe(true);
  });
});

describe("sendDiscordMessage", () => {
  it("no-ops (skipped) without a webhook and never calls fetch", async () => {
    delete process.env.DISCORD_WEBHOOK_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendDiscordMessage({ content: "hi", allowed_mentions: { parse: [] } });

    expect(res).toEqual({ ok: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the JSON payload to the webhook and treats 204 as ok", async () => {
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 204 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendDiscordMessage({ content: "hello", allowed_mentions: { parse: [] } });

    expect(res).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ content: "hello", allowed_mentions: { parse: [] } });
  });

  it("surfaces an HTTP error (ok:false) with status", async () => {
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad" } as Response)
    );

    const res = await sendDiscordMessage({ content: "x", allowed_mentions: { parse: [] } });
    expect(res).toEqual({ ok: false, status: 400, error: "bad" });
  });

  it("catches network failures instead of throwing", async () => {
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const res = await sendDiscordMessage({ content: "x", allowed_mentions: { parse: [] } });
    expect(res).toEqual({ ok: false, error: "ECONNRESET" });
  });
});

describe("sendDiscordBuildUpdate", () => {
  it("sends the formatted build-update embed", async () => {
    process.env.DISCORD_WEBHOOK_URL = WEBHOOK;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendDiscordBuildUpdate(base, { treasurySol: 12.46 });

    expect(res.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.embeds[0].title).toContain("🤖 Demo Co build update");
  });
});
