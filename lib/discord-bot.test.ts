import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isDiscordBotConfigured,
  ensureChannels,
  findChannelId,
  postToChannel,
  fetchMessagesAfter,
  readOnlyOverwrite,
  DEFAULT_LAYOUT,
  CHANNEL_TYPE,
} from "./discord-bot";

const TOKEN = "bot.token.abc";
const GUILD = "999000111";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_GUILD_ID;
});

function configure() {
  process.env.DISCORD_BOT_TOKEN = TOKEN;
  process.env.DISCORD_GUILD_ID = GUILD;
}

/** A fetch mock that routes by method+path and records the create calls. */
function routeFetch(handlers: {
  list?: unknown[];
  onCreate?: (body: Record<string, unknown>) => unknown;
  messages?: unknown[];
  post?: unknown;
}) {
  const created: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    if (method === "GET" && url.includes(`/guilds/${GUILD}/channels`)) {
      return { ok: true, status: 200, text: async () => JSON.stringify(handlers.list ?? []) } as Response;
    }
    if (method === "POST" && url.includes(`/guilds/${GUILD}/channels`)) {
      created.push(body);
      const made = handlers.onCreate?.(body) ?? { id: `new-${body.name}`, name: body.name, type: body.type };
      return { ok: true, status: 200, text: async () => JSON.stringify(made) } as Response;
    }
    if (method === "GET" && url.includes("/messages")) {
      return { ok: true, status: 200, text: async () => JSON.stringify(handlers.messages ?? []) } as Response;
    }
    if (method === "POST" && url.includes("/messages")) {
      return { ok: true, status: 200, text: async () => JSON.stringify(handlers.post ?? { id: "msg1" }) } as Response;
    }
    return { ok: false, status: 404, text: async () => "not found" } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, created };
}

describe("isDiscordBotConfigured", () => {
  it("requires both token and guild id", () => {
    expect(isDiscordBotConfigured()).toBe(false);
    process.env.DISCORD_BOT_TOKEN = TOKEN;
    expect(isDiscordBotConfigured()).toBe(false);
    process.env.DISCORD_GUILD_ID = GUILD;
    expect(isDiscordBotConfigured()).toBe(true);
  });
});

describe("readOnlyOverwrite", () => {
  it("denies SEND_MESSAGES (1<<11) for @everyone (== guild id)", () => {
    const ov = readOnlyOverwrite(GUILD);
    expect(ov).toEqual([{ id: GUILD, type: 0, deny: String(1 << 11) }]);
  });
});

describe("ensureChannels", () => {
  it("no-ops (skipped) when unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await ensureChannels();
    expect(res.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates only missing channels (idempotent by name) with auth header", async () => {
    configure();
    // Pretend INFO + #general already exist.
    const { fetchMock, created } = routeFetch({
      list: [
        { id: "cat-info", name: "INFO", type: CHANNEL_TYPE.GUILD_CATEGORY },
        { id: "c-gen", name: "general", type: CHANNEL_TYPE.GUILD_TEXT },
      ],
    });
    const res = await ensureChannels();
    expect(res.ok).toBe(true);
    expect(res.existing).toEqual(expect.arrayContaining(["INFO", "general"]));
    // build-log/announcements/welcome/COMMUNITY/ideas/governance get created.
    expect(res.created).toEqual(expect.arrayContaining(["build-log", "ideas", "governance"]));
    expect(res.created).not.toContain("INFO");
    // Auth header present on every call.
    for (const [, init] of fetchMock.mock.calls) {
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bot ${TOKEN}`);
    }
    // build-log nests under INFO and is read-only.
    const buildlog = created.find((b) => b.name === "build-log")!;
    expect(buildlog.parent_id).toBe("cat-info");
    expect(buildlog.permission_overwrites).toEqual(readOnlyOverwrite(GUILD));
  });

  it("creates categories before their children", async () => {
    configure();
    const { created } = routeFetch({ list: [] });
    await ensureChannels(DEFAULT_LAYOUT);
    const names = created.map((c) => c.name as string);
    expect(names.indexOf("INFO")).toBeLessThan(names.indexOf("build-log"));
    expect(names.indexOf("COMMUNITY")).toBeLessThan(names.indexOf("general"));
  });
});

describe("findChannelId", () => {
  it("resolves a channel id by case-insensitive name", async () => {
    configure();
    routeFetch({ list: [{ id: "c-bl", name: "build-log", type: 0 }] });
    expect(await findChannelId("Build-Log")).toBe("c-bl");
    expect(await findChannelId("missing")).toBeNull();
  });
});

describe("postToChannel", () => {
  it("posts payload (dropping webhook-only username) and returns the message id", async () => {
    configure();
    const { fetchMock } = routeFetch({ post: { id: "m42" } });
    const res = await postToChannel("c1", {
      username: "Demo agent",
      content: "gm",
      allowed_mentions: { parse: [] },
    });
    expect(res).toEqual({ ok: true, id: "m42" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.username).toBeUndefined(); // not a bot-API field
    expect(body.content).toBe("gm");
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it("no-ops without a token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await postToChannel("c1", { content: "x", allowed_mentions: { parse: [] } });
    expect(res.skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchMessagesAfter", () => {
  it("returns messages oldest-first and forwards the after cursor", async () => {
    configure();
    const { fetchMock } = routeFetch({
      messages: [
        { id: "30", content: "c", author: { id: "u", username: "u" }, timestamp: "t" },
        { id: "10", content: "a", author: { id: "u", username: "u" }, timestamp: "t" },
        { id: "20", content: "b", author: { id: "u", username: "u" }, timestamp: "t" },
      ],
    });
    const msgs = await fetchMessagesAfter("c1", "5", 50);
    expect(msgs.map((m) => m.id)).toEqual(["10", "20", "30"]);
    expect(fetchMock.mock.calls[0][0]).toContain("after=5");
    expect(fetchMock.mock.calls[0][0]).toContain("limit=50");
  });

  it("returns [] on failure instead of throwing", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    expect(await fetchMessagesAfter("c1")).toEqual([]);
  });
});
