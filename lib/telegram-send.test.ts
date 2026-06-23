import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isTelegramConfigured,
  sendTelegramMessage,
  sendBuildUpdate,
} from "./telegram-send";
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

const okJson = (body: object) =>
  ({ ok: true, json: async () => body, status: 200 }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe("isTelegramConfigured", () => {
  it("reflects whether a bot token is set", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(isTelegramConfigured()).toBe(false);
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    expect(isTelegramConfigured()).toBe(true);
  });
});

describe("sendTelegramMessage", () => {
  it("no-ops (skipped) without a token and never calls fetch", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendTelegramMessage("999", "hi");

    expect(res).toEqual({ ok: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to the bot sendMessage endpoint with MarkdownV2", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    const fetchMock = vi.fn().mockResolvedValue(okJson({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendTelegramMessage("999", "hello *world*");

    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      chat_id: "999",
      text: "hello *world*",
      parse_mode: "MarkdownV2",
      disable_web_page_preview: true,
    });
  });

  it("surfaces a Telegram API error (ok:false) with code + description", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ ok: false, error_code: 403, description: "Forbidden: bot was blocked" }),
      } as Response)
    );

    const res = await sendTelegramMessage("999", "hi");
    expect(res).toEqual({ ok: false, errorCode: 403, error: "Forbidden: bot was blocked" });
  });

  it("catches network failures instead of throwing", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const res = await sendTelegramMessage("999", "hi");
    expect(res).toEqual({ ok: false, error: "ECONNRESET" });
  });
});

describe("sendBuildUpdate", () => {
  it("sends the formatted build-update message", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    const fetchMock = vi.fn().mockResolvedValue(okJson({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendBuildUpdate("999", base, { treasurySol: 12.46 });

    expect(res.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Body is exactly what the pure formatter produces.
    expect(body.text).toContain("🤖 *Demo Co* build update");
    expect(body.text).toContain("💰 Treasury: *12\\.46 SOL*");
  });
});
